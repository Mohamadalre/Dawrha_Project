import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { Role } from '@src/user/enums/role.enum';
import { OdooService } from '@src/odoo/odoo.service';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'DRIVER_REQ_RECONCILE', channel: 'jobs' } as const;

/**
 * Safety net for the backend -> Odoo driver-request push.
 *
 * When a collector finishes onboarding the backend enqueues ONE push job
 * (PUSH_DRIVER_REQUEST). If Odoo is unreachable during that job's short retry
 * window, the job exhausts its attempts and the request is LOST — the account
 * sits in PENDING_APPROVAL forever while NOTHING shows up in Odoo's driver
 * requests (exactly the bug we hit: a pending collector with no Odoo row).
 *
 * This cron closes that gap the same way the fleet reconcile does: it lists the
 * PENDING_APPROVAL collectors, asks Odoo which backend_driver_ids it already
 * has, and re-pushes ONLY the missing ones. The Odoo model upserts by
 * backend_driver_id, so re-pushing is safe and idempotent — Odoo is the single
 * source of truth for the review decision, which returns via the
 * driver-decision webhook.
 *
 * Runs on boot (catch up on anything missed while down) and every 10 minutes.
 */
@Injectable()
export class DriverRequestReconcileService implements OnModuleInit {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(CollectorProfile)
    private readonly collectorRepo: Repository<CollectorProfile>,
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

  private async reconcile(trigger: 'startup' | 'cron'): Promise<void> {
    try {
      // Collectors awaiting a decision — their request MUST exist in Odoo.
      //
      // NEED_CHANGES counts too. It used to look only at PENDING_APPROVAL,
      // which missed a driver who was asked for a document and answered only
      // part of it: he stays NEED_CHANGES here, so a request lost on the way to
      // Odoo left him invisible to the reviewer in the one state where he is
      // actively waiting to be looked at again.
      const pending = await this.accountRepo.find({
        where: [
          { role: Role.COLLECTOR, accountStatus: AccountStatus.PENDING_APPROVAL },
          { role: Role.COLLECTOR, accountStatus: AccountStatus.NEED_CHANGES },
        ],
      });
      if (!pending.length) return;

      // What Odoo already has. If Odoo is unreachable, bail — the next tick
      // (or the boot sync) retries; never crash the loop.
      let odooKeys: Set<string>;
      try {
        odooKeys = new Set(await this.odoo.fetchDriverRequestKeys());
      } catch (err) {
        winstonLogger.warn(
          `Driver-request reconcile skipped (${trigger}) — Odoo unreachable: ${(err as Error).message}`,
          LOG_META,
        );
        return;
      }

      let requeued = 0;
      for (const account of pending) {
        const profile = await this.collectorRepo.findOne({
          where: { account: { id: account.id } },
        });
        if (!profile) continue;
        if (odooKeys.has(profile.id)) continue; // already in Odoo — nothing to do
        // Stable per-account job id so overlapping ticks collapse into one.
        await this.odooSync.enqueuePushDriverRequestReconcile(account.id);
        requeued++;
      }
      if (requeued) {
        winstonLogger.info(
          `Re-pushed ${requeued} missing driver request(s) to Odoo (${trigger})`,
          LOG_META,
        );
      }
    } catch (err) {
      winstonLogger.warn(
        `Driver-request reconcile error (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
  }
}
