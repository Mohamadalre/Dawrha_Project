import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'FLEET_RECONCILE', channel: 'jobs' } as const;

/**
 * Safety net for the Odoo → backend fleet mirror.
 *
 * Odoo pings us (`POST /odoo/webhooks/fleet`) whenever a truck / shift /
 * assignment changes, but that ping is fire-and-forget: if the backend is down,
 * the network drops, or the webhook secret is missing on either side, the event
 * is LOST FOREVER — the mirror then silently drifts from Odoo (e.g. a shift the
 * admin added never reaches the driver app).
 *
 * SYNC_FLEET is not incremental: it re-reads the WHOLE fleet from Odoo and
 * upserts it. So simply running it on a timer repairs any missed event with no
 * outbox table, no change tracking and no bookkeeping — the next run always
 * converges. That makes this the reconciliation layer:
 *
 *   - the Odoo ping  → fast path (changes land within seconds)
 *   - this cron      → safety net (any gap closes within one interval)
 *   - startup sync   → catch-up for whatever changed while we were down
 *
 * Runs in every process that boots AppModule (API and worker). Concurrent
 * triggers collapse via the bucketed jobId in enqueueSyncFleetReconcile().
 */
@Injectable()
export class FleetReconcileService implements OnModuleInit {
  constructor(private readonly odooSync: OdooSyncService) {}

  /** Catch up immediately on boot — covers changes made while we were offline. */
  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  private async reconcile(trigger: 'startup' | 'cron'): Promise<void> {
    try {
      await this.odooSync.enqueueSyncFleetReconcile();
      winstonLogger.info(`Fleet reconciliation queued (${trigger})`, LOG_META);
    } catch (err) {
      // Never let a queue hiccup crash boot or kill the cron: the next tick
      // retries anyway, which is the whole point of a reconciliation loop.
      winstonLogger.warn(
        `Fleet reconciliation could not be queued (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
  }
}
