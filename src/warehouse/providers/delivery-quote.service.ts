import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryTariff } from '../entities/delivery-tariff.entity';
import {
  DeliveryTariffScope,
  SCOPE_SPECIFICITY,
} from '../enums/delivery-tariff-scope.enum';

/** What one delivery leg costs, and which tariff decided it. */
export interface DeliveryQuote {
  cost: number;
  currency: string;
  baseFee: number;
  ratePerKm: number;
  distanceKm: number;
  /** Null when no tariff matches at all — delivery is then simply not priced. */
  tariffId: string | null;
  scope: DeliveryTariffScope | null;
}

const NO_TARIFF: Omit<DeliveryQuote, 'distanceKm'> = {
  cost: 0,
  currency: 'SYP',
  baseFee: 0,
  ratePerKm: 0,
  tariffId: null,
  scope: null,
};

/**
 * Prices one delivery leg (one warehouse → one buyer) from the tariff mirror.
 *
 * Reads only the mirror of `recycle.delivery.tariff`: the Odoo administrator is
 * the sole author, and quoting from a local read is what lets the checkout show
 * a price without depending on Odoo being up at that moment.
 *
 * A split order has one leg per part, so the order total is the sum of the
 * legs — the caller adds them up; this service deliberately knows nothing about
 * orders.
 */
@Injectable()
export class DeliveryQuoteService {
  constructor(
    @InjectRepository(DeliveryTariff)
    private readonly tariffRepo: Repository<DeliveryTariff>,
  ) {}

  /**
   * The tariff that governs a given warehouse, most specific first.
   *
   * One query fetches every tariff that COULD apply, then a single sort picks
   * the winner. Expressing precedence as a sort key (SCOPE_SPECIFICITY) rather
   * than branching means a new scope is one map entry, not a new branch.
   */
  async resolveTariff(
    warehouseId: string,
    provinceId?: string | null,
  ): Promise<DeliveryTariff | null> {
    const candidates = await this.tariffRepo
      .createQueryBuilder('t')
      .where('t.isActive = true')
      .andWhere(
        `(t.scope = :global
          OR (t.scope = :warehouse AND t.warehouseId = :warehouseId)
          OR (t.scope = :province AND t.provinceId = :provinceId))`,
        {
          global: DeliveryTariffScope.GLOBAL,
          warehouse: DeliveryTariffScope.WAREHOUSE,
          province: DeliveryTariffScope.PROVINCE,
          warehouseId,
          // A null provinceId must not match anything, and comparing a uuid
          // column to null would throw — a sentinel keeps the SQL uniform.
          provinceId: provinceId ?? '00000000-0000-0000-0000-000000000000',
        },
      )
      .getMany();

    if (!candidates.length) return null;
    candidates.sort(
      (a, b) => SCOPE_SPECIFICITY[a.scope] - SCOPE_SPECIFICITY[b.scope],
    );
    return candidates[0];
  }

  /**
   * Cost of one delivery leg.
   *
   * `distanceKm` comes from the distance cache, so this is pure arithmetic —
   * no I/O beyond the tariff lookup, and no external service in the path.
   */
  async quoteLeg(params: {
    warehouseId: string;
    provinceId?: string | null;
    distanceKm: number;
  }): Promise<DeliveryQuote> {
    const tariff = await this.resolveTariff(params.warehouseId, params.provinceId);
    const distanceKm = Math.max(params.distanceKm, 0);

    if (!tariff) return { ...NO_TARIFF, distanceKm };

    const baseFee = Number(tariff.baseFee);
    const ratePerKm = Number(tariff.ratePerKm);
    const minFee = Number(tariff.minFee);
    const raw = baseFee + ratePerKm * distanceKm;

    return {
      cost: round3(Math.max(raw, minFee)),
      currency: tariff.currency,
      baseFee,
      ratePerKm,
      distanceKm: round3(distanceKm),
      tariffId: tariff.id,
      scope: tariff.scope,
    };
  }
}

/** Money is stored with 3 decimals across this project; keep quotes aligned. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
