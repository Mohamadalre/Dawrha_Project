import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MaterialCondition,
  UNGRADED_CONDITION,
} from '../../entities/material-condition.entity';
import { InvalidConditionCodeException } from '../../exceptions/waste.exceptions';

/**
 * Read-side helper around the admin-managed material conditions.
 * Same short-TTL in-memory cache pattern as UnitsService — the table is tiny
 * and read on every catalogue/availability mapping.
 */
@Injectable()
export class ConditionsService {
  private static readonly CACHE_TTL_MS = 60_000;

  private cache: MaterialCondition[] | null = null;
  private cacheExpiresAt = 0;

  constructor(
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
  ) {}

  async all(): Promise<MaterialCondition[]> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiresAt) return this.cache;

    this.cache = await this.conditionRepo.find({
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
    this.cacheExpiresAt = now + ConditionsService.CACHE_TTL_MS;
    return this.cache;
  }

  async active(): Promise<MaterialCondition[]> {
    return (await this.all()).filter((c) => c.isActive);
  }

  /** Validates an active condition code; returns it normalized (uppercase). */
  async validateActiveCode(code: string): Promise<string> {
    const normalized = (code ?? '').trim().toUpperCase();
    const conditions = await this.active();
    if (!conditions.some((c) => c.code === normalized)) {
      throw new InvalidConditionCodeException(conditions.map((c) => c.code));
    }
    return normalized;
  }

  /** code → Arabic label. Includes the UNGRADED pseudo-condition. */
  async labelMap(): Promise<Map<string, string>> {
    const conditions = await this.all();
    const map = new Map(conditions.map((c) => [c.code, c.nameAr]));
    map.set(UNGRADED_CONDITION, 'غير مفروزة');
    return map;
  }

  /** Called by the admin write-side after any condition mutation. */
  invalidate(): void {
    this.cache = null;
    this.cacheExpiresAt = 0;
  }
}
