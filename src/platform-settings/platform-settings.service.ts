import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';

/**
 * The single source of truth for platform-wide settings.
 *
 * The only setting today is the default pricing currency. `defaultCurrency()`
 * is what the pricing paths call instead of a hardcoded 'SYP'; it is cached in
 * memory and refreshed on every edit, so reading it is free and changing it
 * takes effect immediately without a redeploy.
 */
@Injectable()
export class PlatformSettingsService {
  /** Cached default currency; refreshed by ensure()/update(). */
  private cachedCurrency: string | null = null;

  constructor(
    @InjectRepository(PlatformSettings)
    private readonly repo: Repository<PlatformSettings>,
  ) {}

  /**
   * The one settings row, created on first use if the seed migration has not
   * run. A creation race (two callers, no row yet) is resolved by reading the
   * winner back — the UNIQUE singleton flag guarantees only one survives.
   */
  async ensure(): Promise<PlatformSettings> {
    let row = await this.repo.findOne({ where: { singleton: true } });
    if (row) {
      this.cachedCurrency = row.defaultCurrency;
      return row;
    }
    try {
      row = await this.repo.save(this.repo.create({ singleton: true }));
    } catch {
      // Lost the race — the other caller's row is now there.
      row = await this.repo.findOne({ where: { singleton: true } });
      if (!row) throw new Error('platform settings row missing after race');
    }
    this.cachedCurrency = row.defaultCurrency;
    return row;
  }

  /** The default currency for new priced rows — cached, so cheap to call. */
  async defaultCurrency(): Promise<string> {
    if (this.cachedCurrency) return this.cachedCurrency;
    const row = await this.ensure();
    return row.defaultCurrency;
  }

  /** Admin: read the current settings. */
  async view() {
    const row = await this.ensure();
    return { message: 'Platform settings fetched successfully', result: this.shape(row) };
  }

  /** Admin: edit the settings in place. */
  async update(input: { defaultCurrency?: string }, adminId: string) {
    const row = await this.ensure();
    if (input.defaultCurrency) {
      row.defaultCurrency = input.defaultCurrency.toUpperCase();
    }
    row.updatedBy = adminId;
    const saved = await this.repo.save(row);
    this.cachedCurrency = saved.defaultCurrency;
    return { message: 'Platform settings updated successfully', result: this.shape(saved) };
  }

  private shape(s: PlatformSettings) {
    return {
      default_currency: s.defaultCurrency,
      updated_at: s.updatedAt,
    };
  }
}
