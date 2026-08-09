import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { PricingService } from './pricing.service';

const LOG_META = { context: 'PRICING_EXPIRY', channel: 'jobs' } as const;

/**
 * Fires the expired-pricing sweep on a schedule.
 *
 * An admin-set expiry only stamps the row with a future end date; something has
 * to act the moment that date passes. This job is that something: every five
 * minutes it asks {@link PricingService.sweepExpiredPricing} to archive any row
 * whose end has arrived and notify the admins that the material has dropped out
 * of the catalogues.
 *
 * Runs ONLY in the dedicated maintenance worker (`MAINTENANCE_WORKER=true`),
 * exactly like {@link MaintenanceService} — the sweep writes and pushes to Odoo,
 * and running it from every API instance at once would archive the same rows
 * several times and fan out duplicate notifications.
 */
@Injectable()
export class PricingExpiryCron {
  constructor(private readonly pricing: PricingService) {}

  private isEnabled(): boolean {
    return process.env.MAINTENANCE_WORKER === 'true';
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const result = await this.pricing.sweepExpiredPricing();
      if (result.rows > 0) {
        winstonLogger.info(
          `Expired pricing swept: ${result.rows} row(s) across ${result.products} material(s)`,
          LOG_META,
        );
      }
    } catch (error) {
      winstonLogger.error(`sweepExpiredPricing failed: ${(error as Error).message}`, {
        ...LOG_META,
        stack: (error as Error).stack,
      });
    }
  }
}
