import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DispatchConfig } from '../entities/dispatch-config.entity';

/**
 * The single dispatch engine configuration, cached for a minute.
 *
 * The engine reads this row on every election, so the admin's dispatch screen
 * can retune weights and windows live — but a cold DB read per election would
 * be waste, hence the short cache. `invalidate()` lets the admin edit route
 * clear it immediately instead of waiting the minute.
 */
@Injectable()
export class DispatchConfigProvider {
  private static readonly CACHE_TTL_MS = 60_000;

  private cached: DispatchConfig | null = null;
  private cachedAt = 0;

  constructor(
    @InjectRepository(DispatchConfig)
    private readonly configRepo: Repository<DispatchConfig>,
  ) {}

  async get(): Promise<DispatchConfig> {
    if (this.cached && Date.now() - this.cachedAt < DispatchConfigProvider.CACHE_TTL_MS) {
      return this.cached;
    }
    const config = await this.configRepo.findOne({ where: { singleton: true } });
    if (!config) {
      // The migration seeds the singleton row; a missing row is a broken install.
      throw new Error('dispatch_config is missing its singleton row');
    }
    this.cached = config;
    this.cachedAt = Date.now();
    return config;
  }

  invalidate(): void {
    this.cached = null;
    this.cachedAt = 0;
  }
}