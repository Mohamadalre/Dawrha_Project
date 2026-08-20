import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { OrderPartLine } from '@src/order/entities/order-part-line.entity';
import { Product } from '../entities/product.entity';
import { PricingTier, tierForRole } from '../enums/pricing-tier.enum';
import { SellabilityService } from '../common/providers/sellability.service';
import { UnitsService } from '../common/providers/units.service';
import { CatalogCacheService } from '../common/providers/catalog-cache.service';

/** Part statuses that mean the warehouse never actually served this line. */
const DEAD_PART_STATUSES = ['REJECTED', 'EXPIRED', 'CANCELLED'] as const;

export interface PopularMaterial {
  id: string;
  name: string;
  image: string | null;
  category: { id: string; name: string | null };
  unit_type: string;
  unit_label: string;
  /** Distinct orders this material appeared in — what the ranking uses. */
  order_count: number;
  /** Total quantity ordered, IN THIS MATERIAL'S OWN UNIT. */
  total_quantity: number;
}

/**
 * Which materials are actually being ordered.
 *
 * **Ranked by how many ORDERS a material appears in, not by summed quantity.**
 * That choice is the whole design. Quantity is recorded in each material's own
 * unit, so summing it is only meaningful WITHIN a material: comparing 5,000 kg
 * of PET against 300 units of a battery is comparing two different physical
 * dimensions, and whichever unit happens to produce bigger numbers would top the
 * list forever regardless of demand. An order count is unit-free, so it compares
 * what it claims to compare.
 *
 * The quantity is still returned — per material, in its own unit and labelled
 * with it — because "how much of this do people order" is a useful figure once
 * it is not being used to rank unlike things against each other.
 *
 * Two filters keep the list honest for whoever is reading it:
 *
 *  - lines belonging to parts a warehouse refused, let expire, or that the buyer
 *    cancelled do not count. Nothing was supplied, so counting them would
 *    measure intent rather than trade;
 *  - a material with no live price for the reader's tier is dropped, for the
 *    same reason the catalogue hides it: recommending something they cannot buy
 *    sends them to a dead end.
 */
@Injectable()
export class PopularityService {
  constructor(
    @InjectRepository(OrderPartLine)
    private readonly lineRepo: Repository<OrderPartLine>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly sellability: SellabilityService,
    private readonly units: UnitsService,
    private readonly cache: CatalogCacheService,
  ) {}

  async mostOrdered(
    role: Role,
    limit: number,
  ): Promise<{ materials: PopularMaterial[] }> {
    const tier = tierForRole(role);
    const cacheKey = `most-ordered:${tier}:${limit}`;
    const cached = await this.cache.get<{ materials: PopularMaterial[] }>(
      'products',
      cacheKey,
    );
    if (cached) return cached;

    // Over-fetch, because the sellability filter runs afterwards: taking exactly
    // `limit` rows here would return fewer than asked whenever any of the top
    // materials is not priced for this tier.
    const ranked = await this.rankedLines(limit * 4);
    if (!ranked.length) return { materials: [] };

    const products = await this.productRepo.find({
      where: { id: In(ranked.map((r) => r.productId)), isActive: true },
      relations: ['category'],
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const sellable = await this.sellability.sellableIds(
      products.map((p) => p.id),
      tier,
    );
    const unitLabels = await this.units.labelMap();

    const materials: PopularMaterial[] = [];
    for (const row of ranked) {
      if (materials.length >= limit) break;
      const product = byId.get(row.productId);
      if (!product || !sellable.has(product.id)) continue;
      materials.push({
        id: product.id,
        name: product.name,
        image: product.imageURL ?? null,
        // The category as one object, matching the rest of the catalogue.
        category: { id: product.categoryId, name: product.category?.name ?? null },
        unit_type: product.unitType,
        unit_label: unitLabels.get(product.unitType) ?? product.unitType,
        order_count: row.orderCount,
        total_quantity: row.totalQuantity,
      });
    }

    const result = { materials };
    await this.cache.set('products', cacheKey, result);
    return result;
  }

  /**
   * Materials by distinct-order count, most ordered first.
   *
   * Aggregated in the database: the answer is a handful of rows however many
   * order lines stand behind it, and a popularity list should not get slower
   * every month the business succeeds.
   */
  private async rankedLines(take: number) {
    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .select('l.productId', 'productId')
      .addSelect('COUNT(DISTINCT p.orderId)', 'orderCount')
      .addSelect('SUM(l.quantity)', 'totalQuantity')
      .innerJoin('order_parts', 'p', 'p.id = l.part_id')
      .where('p.status NOT IN (:...dead)', { dead: [...DEAD_PART_STATUSES] })
      .groupBy('l.productId')
      .orderBy('COUNT(DISTINCT p.orderId)', 'DESC')
      // Tie-break on quantity, then on id: without a total ordering, two
      // materials with the same order count could swap places between calls and
      // the list would look unstable for no reason.
      .addOrderBy('SUM(l.quantity)', 'DESC')
      .addOrderBy('l.productId', 'ASC')
      .limit(take)
      .getRawMany<{
        productId: string;
        orderCount: string;
        totalQuantity: string;
      }>();

    return rows.map((r) => ({
      productId: r.productId,
      orderCount: Number(r.orderCount),
      totalQuantity: Number(r.totalQuantity),
    }));
  }
}
