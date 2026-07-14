import { Injectable } from '@nestjs/common';
import { InvalidUnitCodeException } from '../../exceptions/waste.exceptions';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeasurementUnit } from '../../entities/measurement-unit.entity';

/**
 * Read-side helper around the admin-managed measurement units.
 * The table is tiny and read on every catalogue/cart mapping, so rows are kept
 * in an in-memory cache with a short TTL; admin mutations call invalidate().
 */
@Injectable()
export class UnitsService {
  private static readonly CACHE_TTL_MS = 60_000;

  private cache: MeasurementUnit[] | null = null;
  private cacheExpiresAt = 0;

  constructor(
    @InjectRepository(MeasurementUnit)
    private readonly unitRepo: Repository<MeasurementUnit>,
  ) {}

  async all(): Promise<MeasurementUnit[]> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiresAt) return this.cache;

    this.cache = await this.unitRepo.find({ order: { code: 'ASC' } });
    this.cacheExpiresAt = now + UnitsService.CACHE_TTL_MS;
    return this.cache;
  }

  async active(): Promise<MeasurementUnit[]> {
    return (await this.all()).filter((u) => u.isActive);
  }

  /**
   * Validates that a unit code exists and is active; returns it normalized
   * (uppercase). Throws 400 listing the allowed codes otherwise.
   */
  async validateActiveCode(code: string): Promise<string> {
    const normalized = (code ?? '').trim().toUpperCase();
    const units = await this.active();
    if (!units.some((u) => u.code === normalized)) {
      throw new InvalidUnitCodeException(units.map((u) => u.code));
    }
    return normalized;
  }

  /** code → Arabic label (falls back to the code itself for unknown values). */
  async labelMap(): Promise<Map<string, string>> {
    const units = await this.all();
    return new Map(units.map((u) => [u.code, u.nameAr]));
  }

  /** Codes of weight units — drives the cart minimum-weight rule. */
  async weightCodes(): Promise<Set<string>> {
    const units = await this.all();
    return new Set(units.filter((u) => u.isWeight).map((u) => u.code));
  }

  /** Called by the admin write-side after any unit mutation. */
  invalidate(): void {
    this.cache = null;
    this.cacheExpiresAt = 0;
  }
}
