import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CoverageService } from '../services/coverage.service';
import { DispatchConfigProvider } from '../providers/dispatch-config.provider';

/**
 * Re-distributes idle drivers onto coverage points on the admin-tunable
 * cadence (`rebalance_min` from dispatch_config, default 30).
 *
 * The interval is registered at boot from the config row and re-registered
 * whenever the admin saves a new `rebalance_min` (the dispatch-config admin
 * endpoint drives this cron directly). A missing row falls back to the
 * entity default.
 */
@Injectable()
export class CoverageRebalanceCron implements OnModuleInit {
  private readonly logger = new Logger('COVERAGE_REBALANCE');
  private readonly intervalName = 'coverage-rebalance';

  constructor(
    private readonly coverage: CoverageService,
    private readonly configProvider: DispatchConfigProvider,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reschedule();
  }

  /** Registers (or re-registers) the interval from `rebalance_min`. */
  async reschedule(): Promise<void> {
    const config = await this.configProvider.get();
    const minutes = Math.max(1, config.rebalanceMin);

    try {
      this.scheduler.deleteInterval(this.intervalName);
    } catch {
      // Not registered yet — the first boot or a config save before boot.
    }

    const interval = setInterval(() => void this.rebalance(), minutes * 60_000);
    this.scheduler.addInterval(this.intervalName, interval);
    this.logger.log(`Coverage rebalance scheduled every ${minutes} minute(s)`);
  }

  private async rebalance(): Promise<void> {
    try {
      await this.coverage.distributeIdleDrivers();
    } catch (error) {
      this.logger.error('Coverage rebalance failed', error as Error);
    }
  }
}