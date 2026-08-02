import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { DistanceService } from './distance.service';

const LOG_META = { context: 'DISTANCE_REFRESH', channel: 'orders' } as const;

/**
 * Turns provisional distances into real ones.
 *
 * Delivery is charged per kilometre, so the number matters. When Google cannot
 * be reached during a checkout the buyer is not made to wait — a straight-line
 * estimate is stored and the order proceeds — but that estimate under-reads a
 * real drive, badly in a city. Left alone it would undercharge every future
 * delivery on that route.
 *
 * This sweep is what stops that: it finds pairs still marked provisional and
 * re-asks Google, one batched request per buyer. Frequent enough that an
 * estimate lives minutes rather than forever, and back-off inside the service
 * keeps a genuinely unroutable pair from being re-asked on every run.
 *
 * It is also the warm-up path in disguise. A pair measured here never needs
 * measuring again, so the steady state is that ordering costs no calls at all —
 * which is the actual goal: use Google for accuracy, pay for it once.
 */
@Injectable()
export class DistanceRefreshService {
  constructor(private readonly distance: DistanceService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async refresh(): Promise<void> {
    try {
      const { attempted, upgraded } = await this.distance.upgradeProvisionalDistances();
      if (attempted && !upgraded) {
        // Nothing upgraded despite having work: the key, the quota or the
        // network is the problem, and pricing is silently drifting low.
        winstonLogger.warn(
          `Distance refresh upgraded none of ${attempted} provisional pair(s) — deliveries are still priced on estimates`,
          LOG_META,
        );
      }
    } catch (err) {
      // A failed sweep must not kill the cron; the next tick retries.
      winstonLogger.warn(
        `Distance refresh failed: ${(err as Error).message}`,
        LOG_META,
      );
    }
  }
}
