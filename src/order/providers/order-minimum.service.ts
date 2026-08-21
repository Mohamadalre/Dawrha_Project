import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { PlatformSettingsService } from '@src/platform-settings/platform-settings.service';
import { OrderMinimum } from '../entities/order-minimum.entity';

/** Outcome of the minimum-value check, with the numbers the buyer needs. */
export interface MinimumCheck {
  passed: boolean;
  goodsTotal: number;
  required: number;
  shortfall: number;
  currency: string;
}

/**
 * Admin-managed minimum order value, per buyer role.
 *
 * Factories and free facilities can be held to different minimums — that is
 * the entire reason this is a table keyed by role rather than one number.
 */
@Injectable()
export class OrderMinimumService {
  constructor(
    @InjectRepository(OrderMinimum)
    private readonly minimumRepo: Repository<OrderMinimum>,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * The active minimum for a role, or null when none is configured.
   *
   * Null means "no floor", not "block everything": an admin who has not set a
   * minimum for a role has not decided to forbid that role from ordering, and
   * treating silence as a prohibition would be the wrong default.
   */
  async forRole(role: Role): Promise<OrderMinimum | null> {
    return this.minimumRepo.findOne({ where: { role, isActive: true } });
  }

  /**
   * Checks a goods total against the role's floor.
   *
   * GOODS only — delivery is excluded deliberately. It is a service fee, and
   * counting it would let a distant buyer clear a bar that an identical nearby
   * order fails purely for being far away.
   */
  async check(role: Role, goodsTotal: number): Promise<MinimumCheck> {
    const minimum = await this.forRole(role);
    const required = minimum ? Number(minimum.minOrderValue) : 0;
    const shortfall = Math.max(required - goodsTotal, 0);
    return {
      passed: shortfall <= 0,
      goodsTotal,
      required,
      shortfall: round3(shortfall),
      // The stored row keeps the currency it was saved with; when there is no
      // row, fall back to the LIVE central currency rather than a hardcode.
      currency: minimum?.currency ?? (await this.settings.defaultCurrency()),
    };
  }

  // ── Admin write side ──────────────────────────────────────────────
  async list(): Promise<OrderMinimum[]> {
    return this.minimumRepo.find({ order: { role: 'ASC' } });
  }

  /**
   * Upsert by role. Upsert rather than create+update because the role is
   * unique by design: "the minimum for factories" is a single fact, and a
   * second row for the same role would be a contradiction, not new data.
   */
  async upsert(
    role: Role,
    values: { minOrderValue: number; isActive?: boolean },
    adminId: string,
  ): Promise<OrderMinimum> {
    let row = await this.minimumRepo.findOne({ where: { role } });
    if (!row) row = this.minimumRepo.create({ role });
    row.minOrderValue = String(values.minOrderValue);
    // Currency is never taken from the request — it is the central platform
    // currency, refreshed on every write so a change to the setting reaches this
    // row too. (History/archive rows are separate and keep their own currency.)
    row.currency = await this.settings.defaultCurrency();
    if (values.isActive !== undefined) row.isActive = values.isActive;
    row.updatedBy = adminId;
    return this.minimumRepo.save(row);
  }

  async remove(role: Role): Promise<void> {
    const row = await this.minimumRepo.findOne({ where: { role } });
    if (!row) throw new NotFoundException('No minimum configured for this role');
    await this.minimumRepo.delete(row.id);
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
