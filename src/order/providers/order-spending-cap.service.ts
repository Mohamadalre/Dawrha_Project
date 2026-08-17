import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { OrderSpendingCap } from '../entities/order-spending-cap.entity';
import { SpendingCapPeriod } from '../enums/spending-cap-period.enum';
import { Order } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';

/** Outcome of the spending-cap check, with the numbers the buyer needs. */
export interface SpendingCapCheck {
  passed: boolean;
  period: SpendingCapPeriod | null;
  /** Already spent in the current window (goods only, cancelled excluded). */
  alreadySpent: number;
  /** The ceiling, or null when no active cap is configured. */
  cap: number | null;
  /** What this order would add. */
  incoming: number;
  /** Headroom left AFTER this order; 0 when the order is refused. */
  remaining: number;
  currency: string;
}

/**
 * Admin-managed MAXIMUM order spending, per buyer role, over a daily or monthly
 * window. The ceiling opposite {@link OrderMinimumService}'s floor.
 */
@Injectable()
export class OrderSpendingCapService {
  constructor(
    @InjectRepository(OrderSpendingCap)
    private readonly capRepo: Repository<OrderSpendingCap>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {}

  /** The active cap for a role, or null when none is configured/enabled. */
  async forRole(role: Role): Promise<OrderSpendingCap | null> {
    return this.capRepo.findOne({ where: { role, isActive: true } });
  }

  /**
   * Would this order push the buyer past their role's cap?
   *
   * Sums the GOODS value of the buyer's own orders since the window opened —
   * cancelled orders excluded, because a cancelled order was never spend — and
   * refuses only when the running total PLUS this order would clear the ceiling.
   */
  async check(
    role: Role,
    accountId: string,
    incomingGoodsTotal: number,
  ): Promise<SpendingCapCheck> {
    const cap = await this.forRole(role);
    if (!cap) {
      return {
        passed: true,
        period: null,
        alreadySpent: 0,
        cap: null,
        incoming: round3(incomingGoodsTotal),
        remaining: Infinity,
        currency: 'SYP',
      };
    }

    const ceiling = Number(cap.maxAmount);
    const windowStart = this.windowStart(cap.period);

    // Sum goods spend since the window opened. A raw SUM keeps this to one query
    // no matter how many orders the buyer has placed.
    const { spent } = await this.orderRepo
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.goodsTotal), 0)', 'spent')
      .where('o.buyerAccountId = :accountId', { accountId })
      .andWhere('o.status != :cancelled', { cancelled: OrderStatus.CANCELLED })
      .andWhere('o.createdAt >= :windowStart', { windowStart })
      .getRawOne<{ spent: string }>();

    const alreadySpent = Number(spent ?? 0);
    const projected = alreadySpent + incomingGoodsTotal;
    const passed = projected <= ceiling;

    return {
      passed,
      period: cap.period,
      alreadySpent: round3(alreadySpent),
      cap: ceiling,
      incoming: round3(incomingGoodsTotal),
      remaining: round3(Math.max(ceiling - (passed ? projected : alreadySpent), 0)),
      currency: cap.currency,
    };
  }

  /** Local start of the cap's window. */
  private windowStart(period: SpendingCapPeriod): Date {
    const now = new Date();
    if (period === SpendingCapPeriod.DAILY) {
      now.setHours(0, 0, 0, 0);
      return now;
    }
    // MONTHLY: first of the current month, local time.
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }

  // ── Admin write side ──────────────────────────────────────────────
  async list(): Promise<OrderSpendingCap[]> {
    return this.capRepo.find({ order: { role: 'ASC' } });
  }

  /**
   * Upsert by role — one cap per role, so a second row would be a contradiction
   * rather than new data. Same shape as the minimum's upsert.
   */
  async upsert(
    role: Role,
    values: {
      maxAmount: number;
      period: SpendingCapPeriod;
      currency?: string;
      isActive?: boolean;
    },
    adminId: string,
  ): Promise<OrderSpendingCap> {
    let row = await this.capRepo.findOne({ where: { role } });
    if (!row) row = this.capRepo.create({ role });
    row.maxAmount = String(values.maxAmount);
    row.period = values.period;
    if (values.currency) row.currency = values.currency;
    if (values.isActive !== undefined) row.isActive = values.isActive;
    row.updatedBy = adminId;
    return this.capRepo.save(row);
  }

  async remove(role: Role): Promise<void> {
    const row = await this.capRepo.findOne({ where: { role } });
    if (!row) throw new NotFoundException('No spending cap configured for this role');
    await this.capRepo.delete(row.id);
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
