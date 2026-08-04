import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'WAREHOUSE_RECONCILE', channel: 'jobs' } as const;

/**
 * Safety net for the warehouse mirror (Odoo `recycle.warehouse` → backend
 * `warehouses`).
 *
 * Every other mirror on this system already had one — the fleet, the
 * governorates, the delivery tariffs, the driver requests — and warehouses did
 * not, which left the most important table on the platform with only two ways
 * to stay correct: an announcement that Odoo fires once and forgets, and an
 * admin remembering to press "import from Odoo".
 *
 * Both fail in the same ordinary situation. If this backend is restarting, or
 * the network drops, or the call fails past its retries, that announcement is
 * gone — and nothing will ever send it again. A warehouse created, renamed,
 * emptied or CLOSED during those minutes stays wrong here indefinitely, and the
 * closure is the one that hurts: allocation keeps sending orders to a site that
 * has stopped accepting them.
 *
 * Three layers, the same shape as the fleet and governorate mirrors:
 *
 *   - the per-warehouse ping → fast path (a change lands within seconds)
 *   - this cron              → safety net (any gap closes within one interval)
 *   - startup sync           → catch-up for whatever changed while we were down
 *
 * The sweep is idempotent — it asks Odoo what is true now and writes that — so
 * running it more often than necessary costs only the read. Concurrent triggers
 * collapse via the bucketed jobId in `enqueueSyncAllWarehouses()`.
 */
@Injectable()
export class WarehouseReconcileService implements OnModuleInit {
  constructor(private readonly odooSync: OdooSyncService) {}

  /** Catch up immediately on boot — covers changes made while we were offline. */
  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  private async reconcile(trigger: 'startup' | 'cron'): Promise<void> {
    try {
      await this.odooSync.enqueueSyncAllWarehouses();
      winstonLogger.info(`Warehouse reconciliation queued (${trigger})`, LOG_META);
    } catch (err) {
      // Never let a queue hiccup crash boot or kill the cron: the next tick
      // retries anyway, which is the whole point of a reconciliation loop.
      winstonLogger.warn(
        `Warehouse reconciliation could not be queued (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
  }
}
