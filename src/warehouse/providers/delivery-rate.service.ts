import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DeliveryRate } from '../entities/delivery-rate.entity';

export interface DeliveryRateInput {
  rate_per_km: number;
  base_fee?: number;
  min_charge?: number;
  currency?: string;
  note?: string;
}

/**
 * The per-kilometre delivery rate — one active value, and everything before it.
 *
 * Setting a new rate does NOT overwrite the old one. A delivery quoted last
 * month was quoted at last month's rate, and rewriting the number in place
 * would make every past quote unexplainable to the buyer who paid it and to the
 * admin who has to answer for it. So a change closes the current row and opens
 * a new one, and the history is the audit trail.
 */
@Injectable()
export class DeliveryRateService {
  constructor(
    @InjectRepository(DeliveryRate)
    private readonly rateRepo: Repository<DeliveryRate>,
    private readonly dataSource: DataSource,
  ) {}

  /** The rate in force right now, or null when none has been set yet. */
  async current(): Promise<DeliveryRate | null> {
    return this.rateRepo.findOne({
      where: { isActive: true },
      order: { effectiveFrom: 'DESC' },
    });
  }

  async currentOrFail(): Promise<DeliveryRate> {
    const rate = await this.current();
    if (!rate) {
      throw new NotFoundException(
        'No delivery rate has been set yet — set the price per kilometre first',
      );
    }
    return rate;
  }

  async view() {
    const [active, history] = await Promise.all([
      this.current(),
      this.rateRepo.find({ order: { effectiveFrom: 'DESC' }, take: 20 }),
    ]);
    return {
      // Stated rather than implied: a client that renders `current` without
      // checking would show an empty box that reads like a zero rate.
      is_configured: !!active,
      current: active ? this.shape(active) : null,
      history: history.map((r) => this.shape(r)),
    };
  }

  /**
   * Set a NEW rate. The previous one is closed, never edited.
   *
   * Both halves run in one transaction: two active rates would make every quote
   * depend on which row a query happened to return first.
   */
  async set(input: DeliveryRateInput, adminId: string) {
    this.assertSane(input);

    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(DeliveryRate);
      const now = new Date();

      await repo.update(
        { isActive: true },
        { isActive: false, effectiveUntil: now, updatedBy: adminId },
      );

      return repo.save(
        repo.create({
          ratePerKm: String(input.rate_per_km),
          baseFee: String(input.base_fee ?? 0),
          minCharge: String(input.min_charge ?? 0),
          currency: (input.currency ?? 'JOD').toUpperCase(),
          note: input.note,
          isActive: true,
          effectiveFrom: now,
          createdBy: adminId,
          updatedBy: adminId,
        }),
      );
    });

    return { message: 'Delivery rate updated successfully', result: this.shape(saved) };
  }

  /**
   * Correct the CURRENT rate in place.
   *
   * Separate from `set` on purpose. Setting a new rate is a business decision
   * with a date; this is fixing a typo in the one that is already in force, and
   * conflating them would either fill the history with corrections or let a
   * real change quietly rewrite the past.
   */
  async update(id: string, input: Partial<DeliveryRateInput>, adminId: string) {
    const rate = await this.rateRepo.findOne({ where: { id } });
    if (!rate) throw new NotFoundException('Delivery rate not found');
    if (!rate.isActive) {
      throw new BadRequestException(
        'Only the rate currently in force can be corrected — a superseded rate is what deliveries were actually quoted at',
      );
    }

    const merged: DeliveryRateInput = {
      rate_per_km: input.rate_per_km ?? Number(rate.ratePerKm),
      base_fee: input.base_fee ?? Number(rate.baseFee),
      min_charge: input.min_charge ?? Number(rate.minCharge),
      currency: input.currency ?? rate.currency,
      note: input.note ?? rate.note,
    };
    this.assertSane(merged);

    rate.ratePerKm = String(merged.rate_per_km);
    rate.baseFee = String(merged.base_fee ?? 0);
    rate.minCharge = String(merged.min_charge ?? 0);
    rate.currency = (merged.currency ?? 'JOD').toUpperCase();
    rate.note = merged.note;
    rate.updatedBy = adminId;
    await this.rateRepo.save(rate);

    return { message: 'Delivery rate updated successfully', result: this.shape(rate) };
  }

  /**
   * What a delivery of `distanceKm` costs at the rate in force.
   *
   * The floor is applied last: a very short trip still costs a driver, a
   * vehicle and an hour, and without it the nearest buyer is delivered to at a
   * price that does not cover sending anyone.
   */
  async quote(distanceKm: number) {
    const rate = await this.currentOrFail();
    const distance = Math.max(Number(distanceKm) || 0, 0);
    const raw = Number(rate.baseFee) + distance * Number(rate.ratePerKm);
    const cost = Math.max(raw, Number(rate.minCharge));
    return {
      distance_km: round3(distance),
      base_fee: Number(rate.baseFee),
      rate_per_km: Number(rate.ratePerKm),
      min_charge: Number(rate.minCharge),
      cost: round3(cost),
      currency: rate.currency,
    };
  }

  private assertSane(input: DeliveryRateInput) {
    if (!(input.rate_per_km > 0)) {
      throw new BadRequestException(
        'The price per kilometre must be greater than zero — a rate of zero means every delivery is free',
      );
    }
    for (const [label, value] of [
      ['base fee', input.base_fee],
      ['minimum charge', input.min_charge],
    ] as const) {
      if (value != null && value < 0) {
        throw new BadRequestException(`The ${label} cannot be negative`);
      }
    }
  }

  private shape(r: DeliveryRate) {
    return {
      id: r.id,
      rate_per_km: Number(r.ratePerKm),
      base_fee: Number(r.baseFee),
      min_charge: Number(r.minCharge),
      currency: r.currency,
      is_active: r.isActive,
      effective_from: r.effectiveFrom,
      effective_until: r.effectiveUntil ?? null,
      note: r.note ?? null,
      created_at: r.createdAt,
    };
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
