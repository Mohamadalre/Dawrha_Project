import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { PricingTier } from '../enums/pricing-tier.enum';
import {
  AUDIENCE_ROLES,
  AUDIENCE_QUOTED_TIERS,
  AUDIENCE_TIERS,
  GuestAudience,
  isGradedTier,
  tierKey,
} from '../enums/guest-audience.enum';
import { CatalogCacheService } from '../common/providers/catalog-cache.service';
import { UnitsService } from '../common/providers/units.service';
import { ConditionsService } from '../common/providers/conditions.service';
import { ProductNotFoundException } from '../exceptions/waste.exceptions';
import { buildPagination, PaginationMeta } from '../common/dto/pagination.dto';

export interface GuestAppListQuery {
  page: number;
  limit: number;
  category_id?: string;
  search?: string;
}

export interface GuestAppSearchQuery {
  page: number;
  limit: number;
  query: string;
}

/** One tier's price for a material, in the shape that tier is actually sold in. */
export interface TierPrice {
  /** Flat tiers only: the single price. */
  price?: number;
  /** Graded tiers only: cheapest grade, so a list can show "from X". */
  price_from?: number;
  /** Graded tiers only: every grade of THIS material with its own price. */
  conditions?: { condition: string; condition_label: string; price: number }[];
}

/** The subset of a pricing row this shaping needs — keeps the function testable. */
export interface PriceRowView {
  tier: PricingTier;
  conditionCode?: string | null;
  price: string | number;
  effectiveFrom: Date | string;
}

/**
 * Shapes an audience's price rows into what the app renders.
 *
 * Pure, and separated from the service for the same reason the allocator is: the
 * awkward part of pricing is not fetching it, it is deciding what shape it has,
 * and that decision is worth being able to assert directly with no repositories
 * to stand up.
 *
 * Two rules it exists to enforce:
 *
 * - **A tier with no live row is OMITTED, never returned as 0.** Zero is a
 *   price — it says "we take this for nothing". "We do not buy this from your
 *   kind of buyer" is a different statement, and a client that renders the
 *   number it is given cannot tell them apart.
 * - **Shape follows the MATERIAL, not the tier.** A graded tier gets a price per
 *   grade; but a material with no grades is sold once even to a factory, because
 *   with nothing to distinguish there is no per-grade price to give.
 */
export function mapTierPrices(
  audience: GuestAudience,
  rows: PriceRowView[],
  productId: string,
  conditionLabels: Map<string, string>,
): Record<string, TierPrice> {
  const out: Record<string, TierPrice> = {};

  for (const tier of AUDIENCE_QUOTED_TIERS[audience]) {
    const tierRows = rows.filter((r) => r.tier === tier);
    if (!tierRows.length) continue;

    if (isGradedTier(tier)) {
      const graded = tierRows
        .filter((r) => r.conditionCode)
        .map((r) => ({
          condition: r.conditionCode as string,
          condition_label:
            conditionLabels.get(`${productId}:${r.conditionCode}`) ??
            (r.conditionCode as string),
          price: Number(r.price),
        }))
        .sort((a, b) => a.price - b.price);

      if (graded.length) {
        out[tierKey(tier)] = { price_from: graded[0].price, conditions: graded };
        continue;
      }
      const flat = tierRows.find((r) => !r.conditionCode);
      if (flat) out[tierKey(tier)] = { price: Number(flat.price) };
      continue;
    }

    // Flat tier: newest effective row wins if several are live at once.
    const flat = tierRows
      .filter((r) => !r.conditionCode)
      .sort(
        (a, b) =>
          new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime(),
      )[0];
    if (flat) out[tierKey(tier)] = { price: Number(flat.price) };
  }

  return out;
}

/**
 * The catalogue a VISITOR sees, scoped to the app they opened.
 *
 * Kept apart from `CatalogService` deliberately. That service answers for a
 * signed-in caller and threads a `Caller` through category restrictions,
 * per-account caching and cart-facing rules — none of which exist here. Folding
 * a second, price-revealing audience into it would mean every one of those paths
 * growing a "…unless it is a guest" branch, and the day one of them is forgotten
 * is the day a restricted account reads a sheet it should not.
 *
 * Three rules hold across everything below:
 *
 *   1. **The audience comes from the ROUTE, never from the request.** A visitor
 *      in the user app cannot reach factory pricing by changing a parameter.
 *   2. **Only what a registered account could actually buy is shown.** A
 *      material with no live price for either of the audience's tiers is
 *      suspended for them, and advertising it promises something the system will
 *      refuse after they sign up.
 *   3. **Read only.** There is no cart, no order and no availability here — a
 *      visitor has no account to attach either to, and no location to match
 *      warehouses on.
 */
@Injectable()
export class GuestAppService {
  constructor(
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    private readonly cache: CatalogCacheService,
    private readonly units: UnitsService,
    private readonly conditions: ConditionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------
  /**
   * Categories that actually have something to show this audience.
   *
   * An empty category is a dead end: the visitor taps it, gets nothing, and
   * learns only that the catalogue is unfinished. The emptiness test is the same
   * one the material list applies — a category counts as populated only if it
   * holds a material this audience can be quoted — so tapping a category always
   * lands on the materials that were counted for it.
   */
  async categories(audience: GuestAudience, query: GuestAppListQuery) {
    const cacheKey = `guest-app:${audience}:categories:${query.page}:${query.limit}:${query.search ?? ''}`;
    const cached = await this.cache.get<{
      categories: Record<string, unknown>[];
      pagination: PaginationMeta;
    }>('categories', cacheKey);
    if (cached) return cached;

    const qb = this.categoryRepo
      .createQueryBuilder('c')
      .where('c.isActive = :active', { active: true })
      .andWhere(`EXISTS (${this.sellableProductExistsSql('c.id')})`)
      .setParameter('tiers', [...AUDIENCE_TIERS[audience]]);

    if (query.search) {
      // Prefix matches rank first. The CASE goes through an ALIASED addSelect and
      // the orderBy references the alias — passing the raw CASE straight to
      // orderBy makes TypeORM read it as `alias.column`, and with the paginated
      // getManyAndCount subquery that failed with `"CASE WHEN c" alias was not
      // found` (a 500 on every guest search).
      qb.andWhere('c.name ILIKE :search', { search: `%${query.search}%` })
        .addSelect('CASE WHEN c.name ILIKE :prefix THEN 0 ELSE 1 END', 'name_rank')
        .setParameter('prefix', `${query.search}%`)
        .orderBy('name_rank', 'ASC')
        .addOrderBy('c.name', 'ASC');
    } else {
      qb.orderBy('c.name', 'ASC');
    }

    qb.skip((query.page - 1) * query.limit).take(query.limit);
    const [rows, total] = await qb.getManyAndCount();
    const counts = await this.sellableCounts(audience, rows.map((c) => c.id));

    const result = {
      categories: rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? null,
        image: c.imageCategoryURL || null,
        product_count: counts.get(c.id) ?? 0,
      })),
      pagination: buildPagination(total, query.page, query.limit),
    };
    // Never cache an EMPTY catalogue. An empty result is almost always a
    // transient startup state (data not seeded / synced yet); pinning it for the
    // 12h TTL is exactly how "the default page (limit 10) shows nothing while
    // other limits work" happened — the empty page was cached before any data
    // arrived through a path that does not bump the version (a seed, a migration,
    // an out-of-band insert). Skipping the write costs one cheap query while the
    // catalogue is empty and makes the first real data appear immediately.
    if (total > 0) await this.cache.set('categories', cacheKey, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------
  async products(audience: GuestAudience, query: GuestAppListQuery) {
    const cacheKey = `guest-app:${audience}:products:${query.page}:${query.limit}:${query.category_id ?? ''}:${query.search ?? ''}`;
    const cached = await this.cache.get<{
      products: Record<string, unknown>[];
      pagination: PaginationMeta;
    }>('products', cacheKey);
    if (cached) return cached;

    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .where('p.isActive = :active', { active: true })
      .andWhere(`EXISTS (${this.livePriceExistsSql('p.id')})`)
      .setParameter('tiers', [...AUDIENCE_TIERS[audience]]);

    if (query.category_id) {
      qb.andWhere('p.categoryId = :categoryId', { categoryId: query.category_id });
    }
    if (query.search) {
      // Aliased CASE (see `categories`) — the raw form 500s under the paginated
      // join with `"CASE WHEN p" alias was not found`.
      qb.andWhere('p.name ILIKE :search', { search: `%${query.search}%` })
        .addSelect('CASE WHEN p.name ILIKE :prefix THEN 0 ELSE 1 END', 'name_rank')
        .setParameter('prefix', `${query.search}%`)
        .orderBy('name_rank', 'ASC')
        .addOrderBy('p.name', 'ASC');
    } else {
      qb.orderBy('p.name', 'ASC');
    }

    qb.skip((query.page - 1) * query.limit).take(query.limit);
    const [rows, total] = await qb.getManyAndCount();

    const result = {
      products: await this.mapProducts(audience, rows),
      pagination: buildPagination(total, query.page, query.limit),
    };
    // Same guard as `categories`: an empty list is a transient state, never
    // worth pinning for the TTL. See the note there.
    if (total > 0) await this.cache.set('products', cacheKey, result);
    return result;
  }

  /** One material with its full price matrix for this audience. */
  async productDetail(audience: GuestAudience, productId: string) {
    const product = await this.productRepo.findOne({
      where: { id: productId, isActive: true },
      relations: ['category'],
    });
    if (!product) throw new ProductNotFoundException();

    const prices = await this.livePrices(audience, [productId]);
    // Same rule as the listing, and it has to be: a material reachable by direct
    // id but hidden from every list is a material a client can link to and then
    // fail to buy.
    if (!prices.get(productId)?.length) throw new ProductNotFoundException();

    const [mapped] = await this.mapProducts(audience, [product], prices);
    return { product: mapped };
  }

  // ---------------------------------------------------------------------------
  // Offers
  // ---------------------------------------------------------------------------
  /**
   * Live offers, with their real figures.
   *
   * Targeting is enforced by audience: an offer aimed at factories never appears
   * in the user app. Advertising a discount to visitors who could not claim it
   * even after registering is worse than not advertising it.
   */
  async offers(audience: GuestAudience, query: GuestAppListQuery) {
    const qb = this.offerRepo
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.product', 'p')
      .where('p.isActive = :active', { active: true })
      .andWhere('o.isActive = true')
      .andWhere('o.validFrom <= NOW()')
      .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())')
      .andWhere('(o.targetRoles IS NULL OR o.targetRoles && :roles)', {
        roles: [...AUDIENCE_ROLES[audience]],
      })
      // An offer on a material this audience cannot buy is not an offer to them.
      .andWhere(`EXISTS (${this.livePriceExistsSql('p.id')})`)
      .setParameter('tiers', [...AUDIENCE_TIERS[audience]]);

    if (query.category_id) {
      qb.andWhere('p.categoryId = :categoryId', { categoryId: query.category_id });
    }
    if (query.search) {
      qb.andWhere('p.name ILIKE :search', { search: `%${query.search}%` });
    }

    qb.orderBy('o.discountPercentage', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      offers: rows.map((o) => ({
        offer_id: o.id,
        product_id: o.productId,
        product_name: o.product?.name ?? null,
        product_image: o.product?.imageURL ?? null,
        amount: Number(o.amount),
        discount_percentage: Number(o.discountPercentage),
        condition: o.conditionCode ?? null,
        description: o.description ?? null,
        valid_from: o.validFrom,
        valid_until: o.validUntil ?? null,
      })),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  /**
   * One box, both kinds of answer.
   *
   * A visitor typing "plastic" does not know whether it names a category or a
   * material, and making them choose a tab before they can be told is a question
   * only the system's own table layout is asking. Both lists come back, each
   * paginated by the same page/limit so a client can page them together.
   */
  async search(audience: GuestAudience, query: GuestAppSearchQuery) {
    const [categories, products] = await Promise.all([
      this.categories(audience, {
        page: query.page,
        limit: query.limit,
        search: query.query,
      }),
      this.products(audience, {
        page: query.page,
        limit: query.limit,
        search: query.query,
      }),
    ]);

    return {
      query: query.query,
      categories: categories.categories,
      products: products.products,
      pagination: {
        categories: categories.pagination,
        products: products.pagination,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  /**
   * A material is sellable to this audience when it carries a price row for one
   * of their tiers that is in effect right now.
   *
   * Written as a correlated EXISTS inside the SQL rather than a filter applied
   * after fetching: the page slice and the total have to be computed over the
   * SAME set, or the pagination reports a count the caller can never reach.
   */
  private livePriceExistsSql(productIdColumn: string): string {
    return `SELECT 1 FROM product_pricing pp
              WHERE pp.product_id = ${productIdColumn}
                AND pp.tier IN (:...tiers)
                AND pp.effective_from <= NOW()
                AND (pp.effective_until IS NULL OR pp.effective_until > NOW())`;
  }

  private sellableProductExistsSql(categoryIdColumn: string): string {
    return `SELECT 1 FROM products pr
              WHERE pr.category_id = ${categoryIdColumn}
                AND pr.is_active = true
                AND EXISTS (${this.livePriceExistsSql('pr.id')})`;
  }

  /** How many sellable materials each of these categories holds. */
  private async sellableCounts(
    audience: GuestAudience,
    categoryIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!categoryIds.length) return map;

    const rows = await this.productRepo
      .createQueryBuilder('p')
      .select('p.categoryId', 'categoryId')
      .addSelect('COUNT(*)', 'count')
      .where('p.categoryId IN (:...ids)', { ids: categoryIds })
      .andWhere('p.isActive = true')
      .andWhere(`EXISTS (${this.livePriceExistsSql('p.id')})`)
      .setParameter('tiers', [...AUDIENCE_TIERS[audience]])
      .groupBy('p.categoryId')
      .getRawMany<{ categoryId: string; count: string }>();

    for (const r of rows) map.set(r.categoryId, Number(r.count));
    return map;
  }

  /** Effective price rows of this audience's tiers, grouped by material. */
  private async livePrices(
    audience: GuestAudience,
    productIds: string[],
  ): Promise<Map<string, ProductPricing[]>> {
    const map = new Map<string, ProductPricing[]>();
    if (!productIds.length) return map;

    const rows = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId IN (:...ids)', { ids: productIds })
      .andWhere('pp.tier IN (:...tiers)', { tiers: [...AUDIENCE_TIERS[audience]] })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .getMany();

    for (const row of rows) {
      const list = map.get(row.productId) ?? [];
      list.push(row);
      map.set(row.productId, list);
    }
    return map;
  }

  private async mapProducts(
    audience: GuestAudience,
    rows: Product[],
    preloaded?: Map<string, ProductPricing[]>,
  ) {
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);

    const [prices, unitLabels, offers, conditionLabels] = await Promise.all([
      preloaded ?? this.livePrices(audience, ids),
      this.units.labelMap(),
      this.bestOffers(audience, ids),
      // Keyed by (material, code): the same code names different grades on
      // different materials, so a bare code cannot be labelled.
      this.conditions.labelMapFor(ids),
    ]);

    return rows.map((p) => {
      const offer = offers.get(p.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        image: p.imageURL ?? null,
        category_id: p.categoryId,
        category_name: p.category?.name ?? null,
        unit_type: p.unitType,
        unit_label: unitLabels.get(p.unitType) ?? p.unitType,
        prices: mapTierPrices(audience, prices.get(p.id) ?? [], p.id, conditionLabels),
        has_offer: !!offer,
        offer_amount: offer ? Number(offer.amount) : null,
        discount_percentage: offer ? Number(offer.discountPercentage) : null,
        currency: 'SYP',
        // A visitor can look at all of this; they cannot act on any of it.
        requires_login_to_order: true,
      };
    });
  }

  private async bestOffers(
    audience: GuestAudience,
    productIds: string[],
  ): Promise<Map<string, Offer>> {
    const map = new Map<string, Offer>();
    if (!productIds.length) return map;

    const rows = await this.offerRepo
      .createQueryBuilder('o')
      .where('o.productId IN (:...ids)', { ids: productIds })
      .andWhere('(o.targetRoles IS NULL OR o.targetRoles && :roles)', {
        roles: [...AUDIENCE_ROLES[audience]],
      })
      .andWhere('o.isActive = true')
      .andWhere('o.validFrom <= NOW()')
      .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())')
      .orderBy('o.discountPercentage', 'DESC')
      .getMany();

    for (const o of rows) {
      if (!map.has(o.productId)) map.set(o.productId, o); // best per material
    }
    return map;
  }
}
