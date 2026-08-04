import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { ShiftChangeRequest } from '@src/truck/entities/shift-change-request.entity';
import { ShiftChangeRequestStatus } from '@src/truck/enums/shift-change-request-status.enum';
import { OdooShiftChangeState, OdooService } from '@src/odoo/odoo.service';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'SHIFT_CHANGE_RECONCILE', channel: 'jobs' } as const;

/** Don't replay a decision a webhook may still be delivering. */
const GRACE_MS = 5 * 60 * 1000;

const BATCH = 100;

/** Requests still awaiting an answer — a decided one needs no reconciling. */
const OPEN: readonly ShiftChangeRequestStatus[] = [
  ShiftChangeRequestStatus.PENDING,
  ShiftChangeRequestStatus.PROCESSING,
];

/** Odoo's state → the status this side should hold. */
const EXPECTED: Record<string, ShiftChangeRequestStatus | null> = {
  pending: null, // undecided — nothing to converge to
  processing: ShiftChangeRequestStatus.PROCESSING,
  accepted: ShiftChangeRequestStatus.ACCEPTED,
  rejected: ShiftChangeRequestStatus.REJECTED,
};

/**
 * Converges the SHIFT-CHANGE decision between Odoo and the backend.
 *
 * The manager decides in Odoo and the driver is told here. `PushReconcile`
 * already covers the outbound half — a request created here that never reached
 * Odoo. This covers the return leg, which had nothing.
 *
 * Odoo's `notify_shift_change_status` is strict (it saves nothing the backend
 * did not acknowledge), so the plain failure is handled. Two gaps survive it,
 * exactly as they do for driver decisions: a reply that arrives after Odoo's
 * 8-second timeout — applied here, rolled back there — and a webhook lost after
 * Odoo committed, which leaves the driver waiting for ever on an answer the
 * manager already gave and will never give twice.
 *
 * The asymmetry is the same and for the same reason: when Odoo has decided, the
 * backend is converged automatically, because nothing else will ever do it. When
 * Odoo is still `pending` and the backend is ahead, the request is sitting in
 * the manager's queue and their next action re-sends it, so it is reported and
 * left alone rather than rolled back under a driver who was already answered.
 */
@Injectable()
export class ShiftChangeStateReconcileService implements OnModuleInit {
  constructor(
    @InjectRepository(ShiftChangeRequest)
    private readonly requestRepo: Repository<ShiftChangeRequest>,
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

  async reconcile(
    trigger: 'startup' | 'cron' | 'manual',
  ): Promise<{ converged: number; reported: number }> {
    const result = { converged: 0, reported: 0 };
    try {
      const open = await this.requestRepo.find({
        where: {
          status: In(OPEN as ShiftChangeRequestStatus[]),
          updatedAt: LessThan(new Date(Date.now() - GRACE_MS)),
        },
        take: BATCH,
      });
      if (!open.length) return result;

      let states: OdooShiftChangeState[];
      try {
        states = await this.odoo.fetchShiftChangeStates(open.map((r) => r.id));
      } catch (err) {
        winstonLogger.warn(
          `Shift-change reconcile skipped (${trigger}) — Odoo unreachable: ${(err as Error).message}`,
          LOG_META,
        );
        return result;
      }

      const byId = new Map(states.map((s) => [s.backendRequestId, s]));
      for (const req of open) {
        const state = byId.get(req.id);
        if (!state) continue; // not in Odoo — PushReconcile re-pushes it

        const expected = EXPECTED[state.state] ?? null;
        if (expected === null || expected === req.status) continue;

        await this.odooSync.enqueueShiftChangeDecision({
          requestId: req.id,
          status: expected === ShiftChangeRequestStatus.ACCEPTED
            ? 'ACCEPTED'
            : expected === ShiftChangeRequestStatus.REJECTED
              ? 'REJECTED'
              : 'PROCESSING',
          ...(state.truckOdooId ? { truckOdooId: state.truckOdooId } : {}),
          ...(state.rejectionReason ? { rejectionReason: state.rejectionReason } : {}),
        });
        result.converged++;
        winstonLogger.warn(
          `Replaying lost shift-change decision for ${req.id}: ` +
            `backend=${req.status} -> odoo=${state.state}`,
          LOG_META,
        );
      }

      if (result.converged) {
        winstonLogger.info(
          `Replayed ${result.converged} lost shift-change decision(s) (${trigger})`,
          LOG_META,
        );
      }
    } catch (err) {
      winstonLogger.warn(
        `Shift-change reconcile error (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
    return result;
  }
}
