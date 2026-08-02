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
    return (await this.resolveActiveByCode(code)).code;
  }

  /**
   * The unit ROW behind a code, so a caller can store the link and not just
   * the label.
   */
  async resolveActiveByCode(code: string): Promise<MeasurementUnit> {
    const normalized = (code ?? '').trim().toUpperCase();
    const units = await this.active();
    const unit = units.find((u) => u.code === normalized);
    if (!unit) throw new InvalidUnitCodeException(units.map((u) => u.code));
    return unit;
  }

  /**
   * The unit behind an ID — the way a material is linked to its unit, the same
   * way it is linked to its category.
   *
   * A code is a label that can be renamed and re-used; an id names one row for
   * good. The code stays stored alongside it because Odoo, the cart and the
   * suggestion flow all speak in codes, and a mirror that had to resolve a
   * uuid on every read would be paying for the link twice.
   */
  async resolveActiveById(id: string): Promise<MeasurementUnit> {
    const units = await this.active();
    const unit = units.find((u) => u.id === id);
    if (!unit) throw new InvalidUnitCodeException(units.map((u) => u.code));
    return unit;
  }

  /** id → unit, for shaping responses without a query per material. */
  async byId(): Promise<Map<string, MeasurementUnit>> {
    return new Map((await this.all()).map((u) => [u.id, u]));
  }

  /** code → unit, for the rows that still only carry a code. */
  async byCode(): Promise<Map<string, MeasurementUnit>> {
    return new Map((await this.all()).map((u) => [u.code, u]));
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
