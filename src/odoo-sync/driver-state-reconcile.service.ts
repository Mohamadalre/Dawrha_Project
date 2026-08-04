import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { Media, statusMedia } from '@src/media/entities/media.entity';
import { OdooDriverRequestState, OdooService } from '@src/odoo/odoo.service';
import { OdooSyncService } from './odoo-sync.service';
import { DriverDecisionPayload } from './odoo-sync.constants';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'DRIVER_STATE_RECONCILE', channel: 'jobs' } as const;

/** Don't replay a decision that a webhook may still be delivering. */
const GRACE_MS = 5 * 60 * 1000;

/** Cap the work one tick can schedule after a long outage. */
const BATCH = 100;

/**
 * Converges the DRIVER DECISION between Odoo and the backend after an outage.
 *
 * `DriverRequestReconcileService` covers one half of the split brain: a request
 * that exists here and never reached Odoo. This covers the other half, which is
 * both likelier and worse.
 *
 * Odoo's decision actions are deliberately STRICT — `_send_decision` posts the
 * webhook first and refuses to save anything when the post fails, so a decision
 * can never be recorded in Odoo without the backend hearing it. That closes the
 * ordinary failure. It does NOT close two real ones:
 *
 *   1. TIMEOUT AMBIGUITY. Odoo gives the call 8 seconds. A backend that answers
 *      in 9 has still *applied* the decision — but Odoo saw a failure, raised,
 *      and rolled back. The driver is ACTIVE in the app and `pending` in Odoo.
 *   2. POST-POST ROLLBACK. The webhook lands, then the Odoo transaction fails
 *      afterwards (a concurrent write, a constraint). Same divergence.
 *
 * And symmetrically, if the webhook itself is lost after Odoo committed — the
 * reverse of (1), where the reviewer's screen says "accepted" and the driver is
 * still waiting on a decision that, as far as the app is concerned, was never
 * made.
 *
 * WHICH SIDE WINS IS NOT SYMMETRIC, and that is the whole design here:
 *
 * • **Odoo decided, backend behind → converge automatically.** Odoo owns the
 *   decision (see the architecture note in PROJECT_CONTEXT §7), and nothing
 *   else will ever fix this: the reviewer sees a finished request and will
 *   never open it again. The driver would wait for ever.
 *
 * • **Backend ahead, Odoo still `pending` → report, do NOT revert.** This one
 *   IS self-healing: the request is sitting in the reviewer's queue looking
 *   undecided, and their next click re-sends the decision and converges it.
 *   Auto-reverting would instead throw a working driver out of the app —
 *   destroying a live session to fix a discrepancy that resolves itself.
 *
 * Convergence replays the ordinary `APPLY_DRIVER_DECISION` job rather than
 * writing the account directly, so there is exactly one implementation of what
 * a decision means (status, warehouse mirror, media, device wipe on BLOCKED,
 * and the notification the driver never received).
 */
@Injectable()
export class DriverStateReconcileService implements OnModuleInit {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(CollectorProfile)
    private readonly collectorRepo: Repository<CollectorProfile>,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    private readonly odoo: OdooService,
    private readonly odooSync: OdooSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  async reconcile(trigger: 'startup' | 'cron' | 'manual'): Promise<{
    converged: number;
    reported: number;
    repushed: number;
  }> {
    const result = { converged: 0, reported: 0, repushed: 0 };
    try {
      let states: OdooDriverRequestState[];
      try {
        states = await this.odoo.fetchDriverRequestStates();
      } catch (err) {
        // Odoo unreachable is the normal case this service exists for — the
        // next tick retries. Never let it kill the loop.
        winstonLogger.warn(
          `Driver-state reconcile skipped (${trigger}) — Odoo unreachable: ${(err as Error).message}`,
          LOG_META,
        );
        return result;
      }
      if (!states.length) return result;

      const profiles = await this.collectorRepo.find({
        where: { id: In(states.map((s) => s.backendDriverId)) },
        relations: ['account'],
      });
      const byId = new Map(profiles.map((p) => [p.id, p]));

      const cutoff = Date.now() - GRACE_MS;
      const drifted: string[] = [];

      for (const state of states) {
        if (result.converged >= BATCH) break;
        const profile = byId.get(state.backendDriverId);
        if (!profile?.account) continue; // request for a driver we don't have

        const expected = this.expectedStatus(state);
        const actual = profile.account.accountStatus;

        // A decision applied moments ago may still be in flight — give the
        // webhook its grace period before calling anything a divergence.
        const decidedAt = profile.account.updatedAt?.getTime?.() ?? 0;
        if (decidedAt >= cutoff) continue;

        if (expected === null) {
          // Odoo has not decided. The backend being ahead is self-healing (the
          // request is still in the reviewer's queue), so name it and leave the
          // live account alone — reverting it would log a working driver out.
          if (actual !== AccountStatus.PENDING_APPROVAL) {
            drifted.push(`${state.backendDriverId} (odoo=pending, backend=${actual})`);
            result.reported++;
          }
          continue;
        }

        // The driver ANSWERED and Odoo never heard: his re-upload updates the
        // media row here and re-pushes the whole request, but that push has no
        // other safety net — the request already exists in Odoo, so the
        // existence reconciler waves it through while the reviewer goes on
        // looking at the file the driver already replaced.
        if (await this.answeredButNotPushed(state)) {
          await this.odooSync.enqueuePushDriverRequestReconcile(profile.account.id);
          result.repushed++;
          winstonLogger.warn(
            `Re-pushing driver ${state.backendDriverId}: documents were replaced here ` +
              `but Odoo still shows the old request`,
            LOG_META,
          );
          continue;
        }

        if (expected === actual && !(await this.mediaDrift(state))) continue;

        await this.odooSync.enqueueDriverDecision(this.payloadFor(state, expected));
        result.converged++;
        winstonLogger.warn(
          `Replaying lost Odoo decision for driver ${state.backendDriverId}: ` +
            `backend=${actual} -> odoo=${expected}`,
          LOG_META,
        );
      }

      if (drifted.length) {
        winstonLogger.warn(
          `${drifted.length} driver(s) decided in the backend but still open in Odoo — ` +
            `the reviewer's next action converges them: ${drifted.slice(0, 10).join(', ')}`,
          LOG_META,
        );
      }
      if (result.converged) {
        winstonLogger.info(
          `Replayed ${result.converged} lost driver decision(s) from Odoo (${trigger})`,
          LOG_META,
        );
      }
    } catch (err) {
      winstonLogger.warn(
        `Driver-state reconcile error (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
    return result;
  }

  /**
   * The account status Odoo's decision implies, or null when Odoo has not
   * decided yet (nothing to converge TO).
   *
   * `is_blocked` is checked first because it is an overlay on an accepted
   * request, not a state of its own.
   */
  private expectedStatus(state: OdooDriverRequestState): AccountStatus | null {
    if (state.isBlocked) return AccountStatus.BLOCKED;
    switch (state.state) {
      case 'accepted':
        return AccountStatus.ACTIVE;
      case 'rejected':
        return AccountStatus.REJECTED;
      case 'need_changes':
        return AccountStatus.NEED_CHANGES;
      default:
        return null;
    }
  }

  /**
   * True when the driver has replaced a document that Odoo still shows as the
   * old one — i.e. the re-push his re-upload triggered was lost.
   *
   * THE COMPARISON IS ON THE URL, deliberately. The obvious test — "Odoo still
   * wants it, we say he answered" — cannot tell the two failures apart, because
   * a re-upload writes exactly what a row that was never told anything looks
   * like: it resets `status` to PENDING and clears `reuploadRequestedAt`. So
   * `PENDING + no request` means either "he replaced it" or "we never heard it
   * was rejected", and acting on the wrong one is harmful in both directions —
   * re-pushing a lost rejection would overwrite Odoo's verdict with our stale
   * copy, and replaying a decision onto an answered document would drag a
   * driver who has already fixed everything back into NEED_CHANGES.
   *
   * The file itself is the thing that actually changed, so it is the thing to
   * compare. Odoo's copy of the URL is only ever written by a push from here.
   */
  private async answeredButNotPushed(state: OdooDriverRequestState): Promise<boolean> {
    const known = state.images.filter((i) => i.url);
    if (!known.length) return false;
    const rows = await this.mediaRepo.find({
      where: { id: In(known.map((i) => i.backendMediaId)), ownerId: state.backendDriverId },
      select: ['id', 'url'],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return known.some((img) => {
      const row = byId.get(img.backendMediaId);
      return !!row?.url && row.url !== img.url;
    });
  }

  /**
   * True when a document's judgement in Odoo is not reflected here.
   *
   * Worth its own check because the media rows gate the driver's re-upload
   * route: a document Odoo rejected but the backend still shows PENDING cannot
   * be replaced by the driver, so he is asked for a file the API will refuse.
   */
  private async mediaDrift(state: OdooDriverRequestState): Promise<boolean> {
    const rejected = state.images.filter((i) => i.status === 'rejected');
    if (!rejected.length) return false;
    const rows = await this.mediaRepo.find({
      where: { id: In(rejected.map((i) => i.backendMediaId)), ownerId: state.backendDriverId },
      select: ['id', 'status', 'reuploadRequestedAt'],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return rejected.some((img) => {
      const row = byId.get(img.backendMediaId);
      if (!row) return false; // media deleted here — not this service's business
      if (row.status !== statusMedia.REJECTED) return true;
      // Odoo asked for it again but the backend never recorded the request.
      return img.reuploadRequested && !row.reuploadRequestedAt;
    });
  }

  /**
   * Rebuild the webhook payload Odoo would have sent, from the state it holds.
   *
   * `requestReupload` is set only for NEED_CHANGES because that flag is what
   * records a document as ASKED FOR — replaying it on an accepted or rejected
   * request would tell a settled driver to go re-upload something.
   */
  private payloadFor(
    state: OdooDriverRequestState,
    expected: AccountStatus,
  ): DriverDecisionPayload {
    const asked = state.images.filter((i) => i.reuploadRequested).map((i) => i.backendMediaId);
    const rejected = state.images
      .filter((i) => i.status === 'rejected')
      .map((i) => i.backendMediaId);

    const payload: DriverDecisionPayload = {
      backendDriverId: state.backendDriverId,
      status: expected,
    };
    if (state.rejectionReason) payload.rejectionReason = state.rejectionReason;
    if (state.warehouseOdooId) payload.warehouseOdooId = state.warehouseOdooId;

    if (expected === AccountStatus.NEED_CHANGES) {
      payload.rejectedMediaIds = asked.length ? asked : rejected;
      payload.requestReupload = true;
    } else if (rejected.length) {
      payload.rejectedMediaIds = rejected;
    }
    return payload;
  }
}
