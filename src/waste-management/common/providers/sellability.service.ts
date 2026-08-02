import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductPricing } from '../../entities/product-pricing.entity';
import { PricingTier } from '../../enums/pricing-tier.enum';

/** What a buyer of one tier may actually order of one material. */
export interface Sellability {
  sellable: boolean;
  /** Grade → price. Empty key '' when the material is ungraded. */
  priceByCondition: Map<string, number>;
}

/**
 * Answers one question, and it is the question that keeps the catalogue honest:
 *
 *   **can THIS buyer actually buy THIS material?**
 *
 * The answer is not "does the material exist" — it is "does it have a live
 * price for this buyer's tier". A material priced for factories but not for
 * citizens does not exist as far as a citizen is concerned, and showing it to
 * them is not a cosmetic problem: they add it to a basket, reach checkout, and
 * the order fails on a line that could never have been priced. The failure
 * arrives at the worst possible moment and with no explanation the buyer can
 * act on.
 *
 * So the rule is applied in ONE place and consulted everywhere a material could
 * reach a buyer — the listing, the detail page, the cart, and the checkout —
 * rather than being re-derived (and re-forgotten) at each of them.
 */
@Injectable()
export class SellabilityService {
  constructor(
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
  ) {}

  /**
   * Live prices for a tier across many materials, in one query.
   *
   * "Live" means effective now: a price with a future start or a past end is
   * not a price the buyer can be charged, so it must not make a material
   * visible either.
   */
  async forProducts(
    productIds: string[],
    tier: PricingTier,
  ): Promise<Map<string, Sellability>> {
    const result = new Map<string, Sellability>();
    if (!productIds.length) return result;

    const rows = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId IN (:...productIds)', { productIds })
      .andWhere('pp.tier = :tier', { tier })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .getMany();

    for (const row of rows) {
      const entry =
        result.get(row.productId) ?? {
          sellable: true,
          priceByCondition: new Map<string, number>(),
        };
      entry.priceByCondition.set(row.conditionCode ?? '', Number(row.price));
      result.set(row.productId, entry);
    }
    return result;
  }

  /** Only the materials this tier can actually buy. */
  async sellableIds(
    productIds: string[],
    tier: PricingTier,
  ): Promise<Set<string>> {
    return new Set((await this.forProducts(productIds, tier)).keys());
  }

  async forProduct(productId: string, tier: PricingTier): Promise<Sellability> {
    const map = await this.forProducts([productId], tier);
    return (
      map.get(productId) ?? { sellable: false, priceByCondition: new Map() }
    );
  }

  /**
   * The price this buyer pays, or null when they cannot buy it at all.
   *
   * A graded material is priced per grade, so a grade with no price is just as
   * unbuyable as a material with no price — and for the same reason: there is
   * no number to charge.
   */
  async priceFor(
    productId: string,
    tier: PricingTier,
    conditionCode?: string | null,
  ): Promise<number | null> {
    const { priceByCondition } = await this.forProduct(productId, tier);
    if (!priceByCondition.size) return null;
    const price = priceByCondition.get(conditionCode ?? '');
    return price ?? null;
  }

  /**
   * Refuses, in plain words, when a buyer reaches for something they cannot buy.
   *
   * Called at the two moments a material can still slip through even though the
   * listing hid it: adding to the cart, and checking out with a cart item whose
   * price was withdrawn in between. That gap is real — an admin can delete a
   * price list while a basket is sitting open — and it is exactly the case that
   * would otherwise fail deep inside order creation.
   */
  async assertSellable(
    productId: string,
    productName: string,
    tier: PricingTier,
    conditionCode?: string | null,
  ): Promise<number> {
    const price = await this.priceFor(productId, tier, conditionCode);
    if (price == null) {
      throw new BadRequestException(
        `"${productName}" is not available for purchase at the moment`,
      );
    }
    return price;
  }

  /**
   * Materials whose whole price list is gone.
   *
   * Used by the admin views and by Odoo, which shows a suspended material as
   * such instead of silently listing it with no prices.
   */
  async unpricedProducts(productIds: string[]): Promise<Set<string>> {
    if (!productIds.length) return new Set();
    const rows = await this.pricingRepo
      .createQueryBuilder('pp')
      .select('DISTINCT pp.productId', 'productId')
      .where('pp.productId IN (:...productIds)', { productIds })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .getRawMany<{ productId: string }>();

    const priced = new Set(rows.map((r) => r.productId));
    return new Set(productIds.filter((id) => !priced.has(id)));
  }
}
