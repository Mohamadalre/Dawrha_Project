import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'DELIVERY_TARIFF_RECONCILE', channel: 'jobs' } as const;

/**
 * Safety net for the delivery-pricing mirror (Odoo `recycle.delivery.tariff` →
 * backend `delivery_tariffs`).
 *
 * The Odoo admin's edit fires a fire-and-forget ping. If the backend is down or
 * the network drops at that moment, the ping is lost and the mirror keeps
 * quoting the OLD price — a buyer would then be charged a delivery fee the
 * administrator already changed, which is worse than a missing feature.
 *
 * The sync job replaces the whole (small) table, so simply re-running it on a
 * timer repairs any missed edit with no outbox and no change tracking. Same
 * three layers used everywhere else here:
 *
 *   - the Odoo ping → fast path (a price change lands within seconds)
 *   - this cron     → safety net (any gap closes within one interval)
 *   - startup sync  → catch-up for whatever changed while we were down
 */
@Injectable()
export class DeliveryTariffReconcileService implements OnModuleInit {
  constructor(private readonly odooSync: OdooSyncService) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  private async reconcile(trigger: 'startup' | 'cron'): Promise<void> {
    try {
      await this.odooSync.enqueueSyncDeliveryTariffs();
      winstonLogger.info(`Delivery-tariff reconciliation queued (${trigger})`, LOG_META);
    } catch (err) {
      // A queue hiccup must not crash boot or kill the cron — the next tick
      // retries, which is the whole point of a reconciliation loop.
      winstonLogger.warn(
        `Delivery-tariff reconciliation could not be queued (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
  }
}
