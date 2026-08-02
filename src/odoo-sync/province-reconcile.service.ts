import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'PROVINCE_RECONCILE', channel: 'jobs' } as const;

/**
 * Safety net for the governorate mirror (backend `provinces` → Odoo
 * `recycle.province`).
 *
 * Warehouses in Odoo LINK to this table, so a governorate that never arrived
 * does not merely look wrong — it blocks the warehouse create outright ("Unknown
 * governorate"). A per-row push is fire-and-forget: if Odoo is down or the RPC
 * fails past its retries, that row is lost and only a manual re-save would ever
 * send it again.
 *
 * SYNC_ALL_PROVINCES is not incremental: it re-pushes the WHOLE list and Odoo
 * archives whatever is no longer in it. Running that on a timer repairs any
 * missed add, rename or delete with no outbox table and no change tracking —
 * the next run always converges. Three layers, same shape as the fleet mirror:
 *
 *   - the per-row job → fast path (a change lands within seconds)
 *   - this cron       → safety net (any gap closes within one interval)
 *   - startup sync    → catch-up for whatever changed while we were down
 *
 * The list is small and changes rarely, so the interval is deliberately long;
 * concurrent triggers collapse via the bucketed jobId in
 * enqueueSyncAllProvinces().
 */
@Injectable()
export class ProvinceReconcileService implements OnModuleInit {
  constructor(private readonly odooSync: OdooSyncService) {}

  /** Catch up immediately on boot — covers changes made while we were offline. */
  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  private async reconcile(trigger: 'startup' | 'cron'): Promise<void> {
    try {
      await this.odooSync.enqueueSyncAllProvinces();
      winstonLogger.info(`Governorate reconciliation queued (${trigger})`, LOG_META);
    } catch (err) {
      // Never let a queue hiccup crash boot or kill the cron: the next tick
      // retries anyway, which is the whole point of a reconciliation loop.
      winstonLogger.warn(
        `Governorate reconciliation could not be queued (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
  }
}
