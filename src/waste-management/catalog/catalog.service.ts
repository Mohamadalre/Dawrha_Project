import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { PricingTier, tierForRole } from '../enums/pricing-tier.enum';
import {
  OfferAudience,
  audienceForRole,
  offerPercentage,
  priceAfterOffer,
} from '../enums/offer-audience.enum';
import { AssignedCategoryProvider } from '@src/waste-management/common/providers/assigned-category.provider';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';
import { BuyerProfileService } from '@src/waste-management/common/providers/buyer-profile.service';
import { WarehouseState } from '@src/warehouse/enums/warehouse-state.enum';
import { EffectivePriceService } from '@src/waste-management/common/providers/effective-price.service';
import {
  CategoryNotAccessibleException,
  CategoryNotFoundException,
  MaterialsNotApplicableException,
  OfferNotFoundException,
  ProductNotFoundException,
} from '../exceptions/waste.exceptions';
import { buildPagination, PaginationMeta, PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import {
  ByPriceQueryDto,
  CategoryQueryDto,
  OfferQueryDto,
  OfferSearchQueryDto,
  ProductQueryDto,
  SearchQueryDto,
} from './dto/catalog-query.dto';

interface Caller {
  id: string;
  role: Role;
}

export interface CategoryListResult {
  categories: Record<string, unknown>[];
  pagination: PaginationMeta;
}

export interface ProductListResult {
  category?: Record<string, unknown>;
  products: Record<string, unknown>[];
  pagination: PaginationMeta;
}

export interface OfferListResult {
  offers: Record<string, unknown>[];
  pagination: PaginationMeta;
}

/**
 * What a guest may filter materials by.
 *
 * Its own type rather than the buyer's ProductQueryDto: that one carries
 * price_min / price_max, and a price filter is a way of reading prices back out
 * one range at a time. Sharing the type would put the leak one inherited field
 * away.
 */
export interface GuestProductQuery {
  page: number;
  limit: number;
  category_id?: string;
  search?: string;
}

/** Per-warehouse availability block returned by getProductAvailability. */
export interface AvailabilityWarehouseEntry {
  warehouse_id: string;
  name: string;
  code: string;
  address: string | null;
  quantity: number;
  reserved_quantity: number;
  available: number;
  synced_at: Date | null;
  conditions: Record<string, unknown>[];
}

/**
 * Read-side service backing the home screen for every buyer role.
 *
 * Restricted roles (INSTITUTIONS / FACTORY / EXTERNAL_PARTNER) are automatically
 * limited to the categories assigned to them at registration. CITIZEN and ADMIN
 * see the full active catalogue.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
    private readonly assignedCategories: AssignedCategoryProvider,
    private readonly cache: CatalogCacheService,
    private readonly units: UnitsService,
    private readonly conditionsService: ConditionsService,
    private readonly buyerProfiles: BuyerProfileService,
    private readonly effectivePrice: EffectivePriceService,
  ) {}

  // ---------------------------------------------------------------------------
  // Material grades — always scoped to ONE material.
  // A global picker would offer a buyer grades the material in front of them
  // does not have, and an ungraded material would appear to have some.
  // ---------------------------------------------------------------------------
  /**
   * The grades of ONE material, each with how much is on hand and what it costs
   * — the picker a factory or free facility uses before ordering.
   *
   * For a graded material it returns, per condition:
   *   - `available`: the stock a buyer in THIS governorate could actually be
   *     filled from (allocation never reaches out of the buyer's governorate,
   *     so a nationwide figure would overpromise);
   *   - `base_price` / `price`: the caller's OWN tier price, with any live offer
   *     applied to `price` (offer details alongside).
   *
   * A material with NO grades is not an error — it just is not sold by grade, so
   * it says so plainly rather than returning an empty list the client has to
   * interpret. Prices and stock are only meaningful for the graded buyer tiers
   * (factory / free facility); other roles get the grade metadata alone.
   */
  async getConditions(caller: Caller, productId: string) {
    const product = await this.productRepo.findOne({
      where: { id: productId, isActive: true, category: { isActive: true } },
      relations: ['category'],
    });
    if (!product) throw new ProductNotFoundException();

    // A category-restricted buyer must not read a material outside their scope.
    const allowed = await this.allowedCategoryIds(caller);
    if (allowed && !allowed.includes(product.categoryId)) {
      throw new ProductNotFoundException();
    }

    // Grades are a GRADED-BUYER concern only. A citizen or an institution never
    // sees a material's grades — even when it has some — so this returns nothing
    // to show for them, and no grade keys at all.
    const tier = tierForRole(caller.role);
    const graded =
      tier === PricingTier.FACTORY || tier === PricingTier.FREE_FACILITY;
    if (!graded) {
      return { product_id: productId, has_conditions: false, conditions: [] };
    }

    const conditions = await this.conditionsService.activeForProduct(productId);
    if (conditions.length === 0) {
      return {
        product_id: productId,
        has_conditions: false,
        message: 'This material has no conditions',
        conditions: [],
      };
    }

    // Per-condition available stock in the buyer's OWN governorate.
    const stock = await this.conditionAvailabilityInGovernorate(product, caller);

    const rows = await Promise.all(
      conditions.map(async (c) => {
        // The caller's own price for this grade, offer applied — one helper,
        // shared with the basket and checkout, so the three never disagree.
        const eff = await this.effectivePrice.effectivePrice(
          productId,
          caller.role,
          c.code,
        );
        // The offer as ONE object, or null — no scattered offer_* fields.
        const offer =
          eff?.offer && eff.basePrice != null
            ? {
                old_price: eff.basePrice,
                new_price: eff.price,
                amount: Number(eff.offer.amount),
                percentage: offerPercentage(eff.basePrice, Number(eff.offer.amount)),
                currency: 'SYP',
                expires_at: eff.offer.validUntil ?? null,
              }
            : null;
        return {
          id: c.id,
          code: c.code,
          name_en: c.nameEn,
          name_ar: c.nameAr,
          sort_order: c.sortOrder,
          available: stock.get(c.code) ?? 0,
          base_price: eff?.basePrice ?? null,
          price: eff?.price ?? null,
          currency: 'SYP',
          offer,
        };
      }),
    );

    return { product_id: productId, has_conditions: true, conditions: rows };
  }

  /**
   * Total available stock per condition for this material, counting ONLY the
   * warehouses a buyer in the caller's governorate could be allocated from —
   * active, in their governorate, and not closing. Mirrors the scope the
   * availability route and the allocator use.
   */
  private async conditionAvailabilityInGovernorate(
    product: Product,
    caller: Caller,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!product.odooProductId) return map; // never synced → no stock lines

    const provinceId = await this.buyerProfiles.provinceForBuyer(
      caller.id,
      caller.role,
    );

    const qb = this.inventoryRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.warehouse', 'w')
      .where('inv.odooProductId = :odooProductId', {
        odooProductId: product.odooProductId,
      })
      .andWhere('w.state = :whActive', { whActive: WarehouseState.ACTIVE });
    if (provinceId) {
      qb.andWhere('w.provinceId = :provinceId', { provinceId }).andWhere(
        'w.state = :active',
        { active: WarehouseState.ACTIVE },
      );
    }

    const rows = await qb.getMany();
    for (const r of rows) {
      const available = Math.max(
        Number(r.quantity) - Number(r.reservedQuantity),
        0,
      );
      const code = r.conditionCode ?? '';
      map.set(code, (map.get(code) ?? 0) + available);
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Measurement units (active only — pickers in the buyer apps)
  // ---------------------------------------------------------------------------
  async getUnits() {
    const units = await this.units.active();
    return {
      units: units.map((u) => ({
        id: u.id,
        code: u.code,
        name_en: u.nameEn,
        name_ar: u.nameAr,
        is_weight: u.isWeight,
        allows_tolerance: u.allowsTolerance,
      })),
    };
  }

  /**
   * Cache scope: unrestricted roles (CITIZEN/ADMIN) share one cache entry ('all');
   * restricted roles are cached per account because their assigned categories differ.
   * Derived from role alone so a cache HIT needs no DB lookup.
   */
  private scopeFor(caller: Caller | null): string {
    // The TIER is part of the scope, and must be: the product list now hides
    // materials with no live price for the caller's tier, so a factory and a
    // citizen no longer see the same catalogue. Sharing one cache entry between
    // them would serve one role the other's list — including materials they
    // cannot be charged for.
    if (!caller) return 'guest';
    const tier = tierForRole(caller.role);
    // INSTITUTIONS are additionally scoped to their assigned categories, which
    // differ per account.
    return caller.role === Role.INSTITUTIONS
      ? `acc:${caller.id}`
      : `tier:${tier}`;
  }

  /**
   * SQL for "this category holds at least one material this caller can buy".
   *
   * A correlated EXISTS rather than a filter applied after fetching: the page
   * slice and the total have to be computed over the SAME set, or the pagination
   * reports a count the caller can never page to.
   *
   * An ADMIN (and any caller with no buying tier) is judged on active materials
   * alone — they are not buying, so "priced for my tier" is not a question they
   * have, and applying it would hide categories they are meant to administer.
   */
  private buyableProductExistsSql(caller: Caller | null, provinceId?: string | null): string {
    const priced = `AND EXISTS (
             SELECT 1 FROM product_pricing pp
              WHERE pp.product_id = pr.id
                AND pp.tier = :callerTier
                AND pp.effective_from <= NOW()
                AND (pp.effective_until IS NULL OR pp.effective_until > NOW())
           )`;
    // For factories & free facilities the category also has to hold a material
    // with STOCK in their governorate — otherwise it is empty for them.
    const inStock = `AND EXISTS (
             SELECT 1 FROM warehouse_inventory wi
             INNER JOIN warehouses w ON w.id = wi.warehouse_id
              WHERE wi.odoo_product_id = pr.odoo_product_id
                AND w.state = 'ACTIVE'
                ${provinceId ? 'AND w.province_id = :stockProvince' : ''}
                AND (COALESCE(wi.quantity, 0) - COALESCE(wi.reserved_quantity, 0)) > 0
           )`;
    return `SELECT 1 FROM products pr
              WHERE pr.category_id = c.id
                AND pr.is_active = true
                ${this.buyingTier(caller) ? priced : ''}
                ${this.isStockGated(caller) ? inStock : ''}`;
  }

  /** The tier a caller buys at, or null when they do not buy at all. */
  private buyingTier(caller: Caller | null): PricingTier | null {
    if (!caller || caller.role === Role.ADMIN) return null;
    return tierForRole(caller.role);
  }

  /**
   * Whether this caller's catalogue is filtered by warehouse STOCK in their
   * governorate — true for factories and free facilities, who buy from stock.
   * Their catalogue is therefore not cached (stock is live).
   */
  private isStockGated(caller: Caller | null): boolean {
    if (!caller) return false;
    const tier = tierForRole(caller.role);
    return tier === PricingTier.FACTORY || tier === PricingTier.FREE_FACILITY;
  }

  private applyTierParam(qb: { setParameter: (k: string, v: unknown) => unknown }, caller: Caller | null) {
    const tier = this.buyingTier(caller);
    if (tier) qb.setParameter('callerTier', tier);
  }

  /** Assigned-category restriction for the caller, or null for guests/unrestricted. */
  private async allowedCategoryIds(caller: Caller | null): Promise<string[] | null> {
    if (!caller) return null; // guests see the whole (active) catalogue
    return this.assignedCategories.getAssignedCategoryIds(caller.id, caller.role);
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------
  /**
   * FULL category list — every role (and guests) sees all active categories.
   * The categories an account picked during onboarding live in the separate
   * GET /waste/my-categories endpoint.
   */
  async getCategories(caller: Caller | null, query: CategoryQueryDto) {
    // The SCOPE is part of the cache key, and must be: the list below hides
    // categories holding nothing this caller can buy, so a factory and a citizen
    // no longer see the same categories. A shared 'all' entry would serve one
    // role the other's list — the exact bug already fixed on the product list.
    // Stock-gated buyers (factory / free facility) are NOT cached — the list
    // depends on live warehouse stock in their governorate.
    // The ADMIN administers the catalogue, so they see EVERY category — active
    // or not, and even one whose materials are all unpriced or out of stock.
    // Hiding those from them would hide exactly the categories they need to go
    // in and finish. Buyers still get the buyable-only list below.
    const isAdmin = caller?.role === Role.ADMIN;

    const useCache = !this.isStockGated(caller) && !isAdmin;
    const cacheParts = `${this.scopeFor(caller)}:${query.page}:${query.limit}:${query.search ?? ''}:${query.sort}:${query.order}`;
    if (useCache) {
      const cached = await this.cache.get<CategoryListResult>('categories', cacheParts);
      if (cached) return cached;
    }

    const provinceId = this.isStockGated(caller)
      ? await this.buyerProfiles.provinceForBuyer(caller!.id, caller!.role)
      : null;

    const qb = this.categoryRepo.createQueryBuilder('c');
    if (!isAdmin) {
      qb
        .where('c.isActive = :active', { active: true })
        // An empty category is a dead end: the buyer taps it, gets nothing, and
        // learns only that the catalogue is unfinished. "Empty" means empty FOR
        // THEM — a category whose materials are all priced for another tier (or,
        // for a factory / free facility, all out of stock in their governorate)
        // has nothing in it they could buy, and the emptiness test is the same
        // one the material list applies, so tapping a category always lands on
        // the materials that were counted for it.
        .andWhere(`EXISTS (${this.buyableProductExistsSql(caller, provinceId)})`);
      this.applyTierParam(qb, caller);
      if (provinceId) qb.setParameter('stockProvince', provinceId);
    }

    if (query.search) {
      qb.andWhere('c.name ILIKE :search', { search: `%${query.search}%` })
        .setParameter('prefixSearch', `${query.search}%`);
    }

    const sortColumn = query.sort === 'created_at' ? 'c.createdAt' : 'c.name';
    if (query.search) {
      // Autocomplete-friendly: names STARTING with the typed text rank first.
      // Aliased addSelect + orderBy(alias) — the raw CASE in orderBy 500s under
      // the paginated getManyAndCount subquery (`"CASE WHEN c" alias not found`).
      qb.addSelect('CASE WHEN c.name ILIKE :prefixSearch THEN 0 ELSE 1 END', 'name_rank')
        .orderBy('name_rank', 'ASC')
        .addOrderBy(sortColumn, query.order.toUpperCase() as 'ASC' | 'DESC');
    } else {
      qb.orderBy(sortColumn, query.order.toUpperCase() as 'ASC' | 'DESC');
    }
    qb.skip((query.page - 1) * query.limit).take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    const counts = await this.productCounts(rows.map((c) => c.id));

    const result = {
      categories: rows.map((c) => this.mapCategory(c, counts.get(c.id) ?? 0)),
      pagination: buildPagination(total, query.page, query.limit),
    };
    if (useCache) await this.cache.set('categories', cacheParts, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Guest catalogue — what a visitor with no account may see
  // ---------------------------------------------------------------------------
  /**
   * Materials, to a visitor: what we deal in, never what it is worth.
   *
   * No price is shown, and no guest-specific price is invented either. Price is
   * a function of the buyer's TIER — a factory and a citizen are quoted
   * different numbers for the same crate — so a number attached to
   * nobody-in-particular is a number nobody will actually be paid. Showing 10
   * to a visitor who then registers and sees 7 does not read as a tier system;
   * it reads as a bait.
   *
   * What IS shown is the material itself, so a visitor can see the business is
   * real and find their material before deciding to register.
   *
   * Only materials with a LIVE price for SOME tier appear. A material priced
   * for nobody is suspended: it cannot be bought by any account that registers,
   * so advertising it to a visitor promises something the system will not
   * deliver.
   */
  async guestProducts(query: GuestProductQuery) {
    const cacheParts = `guest-products:${query.page}:${query.limit}:${query.category_id ?? ''}:${query.search ?? ''}`;
    const cached = await this.cache.get<ProductListResult>('products', cacheParts);
    if (cached) return cached;

    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .where('p.isActive = :active', { active: true })
      // A material inside a switched-off category is switched off too — the
      // visitor listing has to agree with the signed-in one, or a material
      // disappears the moment somebody logs in.
      .andWhere('c.isActive = :active', { active: true })
      .andWhere(
        `EXISTS (
           SELECT 1 FROM product_pricing pp
            WHERE pp.product_id = p.id
              AND pp.effective_from <= NOW()
              AND (pp.effective_until IS NULL OR pp.effective_until > NOW())
         )`,
      );

    if (query.category_id) {
      qb.andWhere('p.categoryId = :categoryId', { categoryId: query.category_id });
    }
    if (query.search) {
      qb.andWhere('p.name ILIKE :search', { search: `%${query.search}%` });
    }

    qb.orderBy('p.name', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    const unitLabels = await this.units.labelMap();
    const offerFlags = await this.productsWithLiveOffer(rows.map((p) => p.id));

    const result = {
      products: rows.map((p) => this.mapProductForGuest(p, unitLabels, offerFlags)),
      pagination: buildPagination(total, query.page, query.limit),
    };
    await this.cache.set('products', cacheParts, result);
    return result;
  }

  /** One material, to a visitor: its grades by name, still without prices. */
  async guestProductDetail(productId: string) {
    const product = await this.productRepo.findOne({
      // The category has to be live too: a material reachable by direct link
      // while its category is switched off is a material an admin believes
      // they withdrew.
      where: { id: productId, isActive: true, category: { isActive: true } },
      relations: ['category'],
    });
    if (!product) throw new ProductNotFoundException();

    const live = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId = :productId', { productId })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .getCount();
    // Consistent with the listing: a material nobody can buy is not shown to a
    // visitor either, rather than shown and then unbuyable after they register.
    if (!live) throw new ProductNotFoundException();

    const [unitLabels, offerFlags, conditions] = await Promise.all([
      this.units.labelMap(),
      this.productsWithLiveOffer([productId]),
      this.conditionsService.activeForProduct(productId),
    ]);

    return {
      product: {
        ...this.mapProductForGuest(product, unitLabels, offerFlags),
        // Names only. The grades tell a visitor the material is bought at
        // different qualities; the prices behind them are the buyer's business.
        conditions: conditions.map((c) => ({
          code: c.code,
          name_en: c.nameEn,
          name_ar: c.nameAr,
        })),
      },
    };
  }

  /** Which of these materials currently carry an untargeted (public) offer. */
  private async productsWithLiveOffer(productIds: string[]): Promise<Set<string>> {
    if (!productIds.length) return new Set();
    const rows = await this.offerRepo
      .createQueryBuilder('o')
      .select('DISTINCT o.productId', 'productId')
      .where('o.productId IN (:...ids)', { ids: productIds })
      .andWhere('o.isActive = true')
      .andWhere('o.validFrom <= NOW()')
      .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())')
      // Untargeted only, matching what a guest is allowed to see in the offers
      // list — flagging an offer they could never be shown would be a lie.
      .andWhere('o.targetRoles IS NULL')
      .getRawMany<{ productId: string }>();
    return new Set(rows.map((r) => r.productId));
  }

  private mapProductForGuest(
    p: Product,
    unitLabels: Map<string, string>,
    offerFlags: Set<string>,
  ) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      image: p.imageURL ?? null,
      category_id: p.categoryId,
      category_name: p.category?.name ?? null,
      unit_type: p.unitType,
      unit_label: unitLabels.get(p.unitType) ?? p.unitType,
      // The pull, without the number: enough to make registering worth it,
      // not enough to remove the reason to.
      has_offer: offerFlags.has(p.id),
      requires_login: true,
      price_hint: 'Sign in to see prices for your account type',
    };
  }

  // ---------------------------------------------------------------------------
  // Products by category
  // ---------------------------------------------------------------------------
  async getProductsByCategory(caller: Caller, categoryId: string, query: ProductQueryDto) {
    await this.assertCategoryAllowed(caller, categoryId);

    // Stock-gated buyers (factory / free facility) are NOT cached — their list
    // depends on live warehouse stock in their governorate.
    const useCache = !this.isStockGated(caller);
    // `search` is part of the cache key: two requests for the same category that
    // differ only by their search term are different result sets, and sharing
    // one entry would serve the second caller the first's matches.
    const cacheParts = `${this.scopeFor(caller)}:${categoryId}:${query.page}:${query.limit}:${query.sort}:${query.order}:${query.price_min ?? ''}:${query.price_max ?? ''}:${query.search ?? ''}`;
    if (useCache) {
      const cached = await this.cache.get<ProductListResult>('products', cacheParts);
      if (cached) return cached;
    }

    const category = await this.categoryRepo.findOne({ where: { id: categoryId } });
    if (!category) throw new CategoryNotFoundException();

    // Search a material by name WITHIN this category — the same substring +
    // prefix-ranking `queryProducts` gives the all-materials list, so a buyer
    // can filter a long category down to the material they came for.
    const { items, total } = await this.queryProducts(caller, query, {
      categoryId,
      search: query.search,
    });

    const result = {
      category: this.mapCategory(category),
      products: items,
      pagination: buildPagination(total, query.page, query.limit),
    };
    if (useCache) await this.cache.set('products', cacheParts, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Products by price range
  // ---------------------------------------------------------------------------
  async getProductsByPrice(caller: Caller, query: ByPriceQueryDto) {
    const productQuery: ProductQueryDto = {
      page: query.page,
      limit: query.limit,
      sort: 'price',
      order: 'asc',
      price_min: query.min_price,
      price_max: query.max_price,
    };
    const { items, total } = await this.queryProducts(caller, productQuery, {});
    return {
      products: items,
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  /**
   * EVERY material the caller can buy, across all categories — one route with a
   * name search AND a price band, instead of forcing the client to pick between
   * "search" and "by-price".
   *
   * The shared `queryProducts` does the work, so this inherits every rule the
   * catalogue already enforces: only materials with a LIVE price for the
   * caller's TIER (an unpriced or inactive material never appears), inside a
   * live category, scoped to the roles that are category-restricted. Each item
   * carries the caller's OWN price and — for factories / free facilities — its
   * per-condition prices, plus the offers targeted at their role. `search` is a
   * substring match on the name (a single letter returns everything containing
   * it); `price_min` / `price_max` bound the caller's own price. Cached like the
   * category listing, and dropped by the same price/offer/product invalidations.
   */
  async getAllMaterials(caller: Caller, query: ProductQueryDto) {
    // Stock-gated buyers (factory / free facility) are NOT cached — their list
    // depends on live warehouse stock in their governorate.
    const useCache = !this.isStockGated(caller);
    const cacheParts = `${this.scopeFor(caller)}:all:${query.page}:${query.limit}:${query.search ?? ''}:${query.price_min ?? ''}:${query.price_max ?? ''}:${query.sort}:${query.order}`;
    if (useCache) {
      const cached = await this.cache.get<ProductListResult>('products', cacheParts);
      if (cached) return cached;
    }

    const { items, total } = await this.queryProducts(caller, query, {
      search: query.search,
    });
    const result = {
      products: items,
      pagination: buildPagination(total, query.page, query.limit),
    };
    if (useCache) await this.cache.set('products', cacheParts, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Search products & categories
  // ---------------------------------------------------------------------------
  async search(caller: Caller, query: SearchQueryDto) {
    const result: Record<string, unknown> = {};

    if (query.type === 'all' || query.type === 'category') {
      const categories = await this.getCategories(caller, {
        page: query.page,
        limit: query.limit,
        search: query.query,
        sort: 'name',
        order: 'asc',
      });
      result.categories = categories.categories;
      result.categories_pagination = categories.pagination;
    }

    if (query.type === 'all' || query.type === 'product') {
      const { items, total } = await this.queryProducts(
        caller,
        { page: query.page, limit: query.limit, sort: 'name', order: 'asc' },
        { search: query.query },
      );
      result.products = items;
      result.products_pagination = buildPagination(total, query.page, query.limit);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Offers
  // ---------------------------------------------------------------------------
  async getOffers(caller: Caller | null, query: OfferQueryDto) {
    const cacheParts = `${this.scopeFor(caller)}:${caller?.role ?? 'guest'}:${query.page}:${query.limit}:${query.active_only}:${query.sort}`;
    const cached = await this.cache.get<OfferListResult>('offers', cacheParts);
    if (cached) return cached;

    const allowed = await this.allowedCategoryIds(caller);
    if (allowed && allowed.length === 0) {
      return this.emptyList('offers', query.page, query.limit);
    }

    const qb = this.baseOfferQuery(allowed, query.active_only, caller?.role ?? null);

    if (query.sort === 'created_at') {
      qb.orderBy('o.createdAt', 'DESC');
    } else {
      this.orderByRealDiscount(qb, caller?.role ?? null);
    }

    qb.skip((query.page - 1) * query.limit).take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    const bases = await this.basePricesForOffers(rows, this.buyingTier(caller));
    const result = {
      offers: rows.map((o) =>
        this.mapOffer(o, !caller, bases.get(`${o.productId}:${o.conditionCode ?? ''}`)),
      ),
      pagination: buildPagination(total, query.page, query.limit),
    };
    await this.cache.set('offers', cacheParts, result);
    return result;
  }

  async searchOffers(caller: Caller | null, query: OfferSearchQueryDto) {
    const allowed = await this.allowedCategoryIds(caller);
    if (allowed && allowed.length === 0) {
      return this.emptyList('offers', query.page, query.limit);
    }

    // Search by material NAME or by an id — the material's id or the offer's.
    // A buyer who copies an id from one screen into the search box expects a
    // hit, not silence; a term that is a valid UUID is matched against the ids
    // AS WELL AS the name, and a plain word is matched by name alone.
    const term = query.query.trim();
    const byId = isUUID(term);

    const qb = this.baseOfferQuery(allowed, true, caller?.role ?? null)
      .andWhere(
        byId ? '(p.name ILIKE :q OR p.id = :term OR o.id = :term)' : 'p.name ILIKE :q',
        byId ? { q: `%${term}%`, term } : { q: `%${term}%` },
      );

    if (query.category_id) {
      qb.andWhere('p.categoryId = :cid', { cid: query.category_id });
    }

    // Autocomplete-friendly: offers on products whose name STARTS WITH the text
    // come first. The rank is added as a SELECTED, aliased column and ordered by
    // that alias — passing the raw `CASE …` straight to `orderBy` made TypeORM
    // read the whole expression as an `alias.column`, so with pagination joins
    // it failed with `"CASE WHEN p" alias was not found` (a 500 on every search).
    qb.addSelect('CASE WHEN p.name ILIKE :qPrefix THEN 0 ELSE 1 END', 'name_rank')
      .setParameter('qPrefix', `${term}%`)
      .orderBy('name_rank', 'ASC')
      .addOrderBy('o.discountPercentage', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    const bases = await this.basePricesForOffers(rows, this.buyingTier(caller));
    return {
      offers: rows.map((o) =>
        this.mapOffer(o, !caller, bases.get(`${o.productId}:${o.conditionCode ?? ''}`)),
      ),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  /**
   * ONE offer by its id — the same role-gated view the offers list gives, for a
   * single row.
   *
   * Every visibility rule the list applies holds here too: audience, role
   * targeting, the role-specific override, and the active window. An offer the
   * caller could not see in the list is therefore a 404 here as well, never a
   * back-door read of a seller offer or another role's targeted one. Priced by
   * the caller's own role, exactly like each list item.
   */
  async getOfferById(caller: Caller | null, offerId: string) {
    const allowed = await this.allowedCategoryIds(caller);
    if (allowed && allowed.length === 0) throw new OfferNotFoundException();

    const offer = await this.baseOfferQuery(allowed, true, caller?.role ?? null)
      .andWhere('o.id = :offerId', { offerId })
      .getOne();
    if (!offer) throw new OfferNotFoundException();

    const bases = await this.basePricesForOffers([offer], this.buyingTier(caller));
    return {
      offer: this.mapOffer(
        offer,
        !caller,
        bases.get(`${offer.productId}:${offer.conditionCode ?? ''}`),
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // My categories — the categories picked in the onboarding "material" step
  // ---------------------------------------------------------------------------
  /** Onboarding-selected categories of the caller (factory / free facility / institution). */
  async getMyCategories(caller: Caller) {
    const selected = await this.assignedCategories.getSelectedCategoryIds(caller.id, caller.role);
    if (selected === null) throw new MaterialsNotApplicableException();
    if (selected.length === 0) return { categories: [] };

    const rows = await this.categoryRepo.find({
      where: { id: In(selected), isActive: true },
      order: { name: 'ASC' },
    });
    const counts = await this.productCounts(rows.map((c) => c.id));
    return { categories: rows.map((c) => this.mapCategory(c, counts.get(c.id) ?? 0)) };
  }

  // ---------------------------------------------------------------------------
  // My materials — products under the onboarding-selected categories
  // ---------------------------------------------------------------------------
  /**
   * Products belonging to the categories the caller picked in the onboarding
   * "add material information" step (factories, free facilities, institutions).
   * Reads the raw selections from the role's material join table — independent
   * of the catalogue *restriction* logic, which only applies to institutions.
   */
  async getMyMaterials(caller: Caller, query: PaginationQueryDto) {
    const selected = await this.assignedCategories.getSelectedCategoryIds(caller.id, caller.role);
    if (selected === null) {
      throw new MaterialsNotApplicableException();
    }
    if (selected.length === 0) {
      return {
        categories: [],
        products: [],
        pagination: buildPagination(0, query.page, query.limit),
      };
    }

    const [categories, { items, total }] = await Promise.all([
      this.categoryRepo.find({ where: { id: In(selected), isActive: true } }),
      this.queryProducts(
        caller,
        { page: query.page, limit: query.limit, sort: 'name', order: 'asc' },
        { categoryIds: selected },
      ),
    ]);

    return {
      categories: categories.map((c) => this.mapCategory(c)),
      products: items,
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Per-warehouse availability (factories & free facilities)
  // ---------------------------------------------------------------------------
  /**
   * How much of a product is available in every active warehouse.
   * Quantities come from `warehouse_inventory`, which mirrors Odoo's
   * `recycle.stock` lines (pulled by the SYNC_WAREHOUSE job), so this reads
   * locally — no Odoo round-trip per request. Not cached: stock freshness wins.
   */
  async getProductAvailability(caller: Caller, productId: string) {
    const product = await this.productRepo.findOne({
      // Category too — otherwise stock is quotable for a material the catalogue
      // no longer lists, and the order it leads to has nowhere to come from.
      where: { id: productId, isActive: true, category: { isActive: true } },
      relations: ['category'],
    });
    if (!product) throw new ProductNotFoundException();

    // Category-restricted roles must not see products outside their assignment.
    const allowed = await this.allowedCategoryIds(caller);
    if (allowed && !allowed.includes(product.categoryId)) {
      throw new ProductNotFoundException();
    }

    const [conditionLabels, priceByCondition] = await Promise.all([
      this.conditionsService.labelMapFor([product.id]),
      this.callerConditionPrices(product.id, caller),
    ]);

    // Never pushed to Odoo yet → no stock lines can exist for it.
    if (!product.odooProductId) {
      return this.mapAvailability(product, [], conditionLabels, priceByCondition, null);
    }

    // Scoped to the buyer's OWN governorate.
    //
    // Allocation only ever matches a buyer to warehouses in their governorate,
    // so a nationwide availability figure answered a question nobody asked and
    // misled on the one they did: a factory saw 8,000 kg, ordered 5,000, and
    // the allocator found 900 within reach. The number shown before committing
    // has to be the number the order can actually be filled from.
    const provinceId = await this.buyerProfiles.provinceForBuyer(
      caller.id,
      caller.role,
    );

    const qb = this.inventoryRepo
      .createQueryBuilder('inv')
      .innerJoinAndSelect('inv.warehouse', 'w')
      .where('inv.odooProductId = :odooProductId', { odooProductId: product.odooProductId })
      .andWhere('w.state = :whActive', { whActive: WarehouseState.ACTIVE });

    if (provinceId) {
      qb.andWhere('w.provinceId = :provinceId', { provinceId })
        // A warehouse Odoo has put into closing or inactive will not be
        // allocated to either, so counting its stock here would promise from a
        // shelf the order can never reach.
        .andWhere('w.state = :active', { active: WarehouseState.ACTIVE });
    }

    const rows = await qb.orderBy('w.name', 'ASC').getMany();

    return this.mapAvailability(
      product, rows, conditionLabels, priceByCondition, provinceId);
  }

  /**
   * Live prices of the caller's tier for a material (graded tiers only), keyed
   * by condition code — with the conditionless BASE price stored under the empty
   * key so a material that carries no grades can still be priced and gated.
   *
   * Empty for a flat-tier caller; this route is factory / free-facility only, so
   * in practice the map is always the graded price sheet.
   */
  private async callerConditionPrices(
    productId: string,
    caller: Caller,
  ): Promise<Map<string, number>> {
    const tier = tierForRole(caller.role);
    if (tier !== PricingTier.FACTORY && tier !== PricingTier.FREE_FACILITY) {
      return new Map();
    }
    const rows = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId = :productId', { productId })
      .andWhere('pp.tier = :tier', { tier })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .getMany();
    // `conditionCode ?? ''` keeps the base price reachable at the same lookup a
    // conditionless stock row uses (`r.conditionCode ?? ''`).
    return new Map(rows.map((r) => [r.conditionCode ?? '', Number(r.price)]));
  }

  /**
   * Groups the per-condition stock rows by warehouse — GATED, so the availability
   * a factory / free facility sees is only what it could actually buy:
   *
   *   • a grade with nothing available (quantity fully reserved, or zero) is
   *     dropped — you cannot order from an empty shelf;
   *   • a grade with NO live price for the caller's tier is dropped — an
   *     unpriced grade has no figure to charge and must not be offered;
   *   • a warehouse left with no sellable grade is dropped with it;
   *   • and if nothing at all survives, the MATERIAL itself is withheld
   *     (`ProductNotFoundException`) rather than returned as an empty,
   *     unbuyable shell — a material with no price, or none in stock in the
   *     buyer's governorate, must not appear.
   *
   * This mirrors the rule the product listing already applies (only priced, in-
   * stock materials appear); the availability view was the one place a zero /
   * unpriced material could still leak through.
   */
  private mapAvailability(
    product: Product,
    rows: WarehouseInventory[],
    conditionLabels: Map<string, string>,
    priceByCondition: Map<string, number>,
    provinceId: string | null,
  ) {
    let totalAvailable = 0;
    const byWarehouse = new Map<string, AvailabilityWarehouseEntry>();

    for (const r of rows) {
      const quantity = Number(r.quantity);
      const reserved = Number(r.reservedQuantity);
      const available = Math.max(quantity - reserved, 0);

      // Gate 1: nothing to sell in this grade → skip it.
      if (available <= 0) continue;

      // Gate 2: no live price for this grade/base → skip it. A material whose
      // grades are all unpriced ends up with no surviving rows and is withheld
      // below.
      const price = priceByCondition.get(r.conditionCode ?? '') ?? null;
      if (price === null) continue;

      totalAvailable += available;

      let entry = byWarehouse.get(r.warehouseId);
      if (!entry) {
        entry = {
          warehouse_id: r.warehouseId,
          name: r.warehouse.name,
          code: r.warehouse.code,
          address: r.warehouse.address ?? null,
          quantity: 0,
          reserved_quantity: 0,
          available: 0,
          synced_at: r.syncedAt ?? null,
          conditions: [],
        };
        byWarehouse.set(r.warehouseId, entry);
      }
      entry.quantity += quantity;
      entry.reserved_quantity += reserved;
      entry.available += available;
      if (r.syncedAt && (!entry.synced_at || r.syncedAt > entry.synced_at)) {
        entry.synced_at = r.syncedAt;
      }
      entry.conditions.push({
        condition: r.conditionCode,
        // Keyed by (material, code): the same code means different things for
        // different materials, so the bare code is only the last-resort label.
        condition_label:
          conditionLabels.get(`${product.id}:${r.conditionCode}`)
          ?? conditionLabels.get(r.conditionCode)
          ?? r.conditionCode,
        quantity,
        reserved_quantity: reserved,
        available,
        price,
      });
    }

    // Gate 3: no sellable grade anywhere → the material is not returned at all.
    if (byWarehouse.size === 0) {
      throw new ProductNotFoundException();
    }

    return {
      product: {
        id: product.id,
        name: product.name,
        unit_type: product.unitType,
      },
      total_available: totalAvailable,
      in_stock: totalAvailable > 0,
      // Stated, not implied. A caller reading `total_available` needs to know
      // whether it counts the whole country or one governorate — the two are
      // different promises, and a client cannot tell them apart from the number
      // alone.
      scope: provinceId ? 'PROVINCE' : 'ALL',
      province_id: provinceId,
      warehouses: [...byWarehouse.values()],
    };
  }

  // ---------------------------------------------------------------------------
  // Shared internals
  // ---------------------------------------------------------------------------

  /** Core product query used by category listing, search, and price-range. */
  private async queryProducts(
    caller: Caller,
    query: ProductQueryDto,
    filters: { categoryId?: string; categoryIds?: string[]; search?: string },
  ) {
    const allowed = await this.assignedCategories.getAssignedCategoryIds(caller.id, caller.role);
    if (allowed && allowed.length === 0) {
      return { items: [] as unknown[], total: 0 };
    }

    // Factories & free facilities buy from stock in their OWN governorate, so
    // their listing is both gated by it and enriched with the quantity available
    // there. Resolved once and reused for the WHERE filter and the per-material
    // quantity below.
    const stockGated = this.isStockGated(caller);
    const provinceId = stockGated
      ? await this.buyerProfiles.provinceForBuyer(caller.id, caller.role)
      : null;

    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .where('p.isActive = :active', { active: true })
      // A material inside a switched-off CATEGORY is switched off too.
      //
      // This was missing, and it made deactivating a category do almost
      // nothing: `GET /categories` hid it, and every material in it went on
      // being listed, searched and bought. An admin who takes a whole category
      // out of circulation — a material line discontinued, a supply problem —
      // means its materials, not just the heading above them, and having to
      // deactivate each one by hand is a rule that will be half-applied the
      // first time someone is in a hurry.
      .andWhere('c.isActive = :active', { active: true });

    // A material with no LIVE price for this buyer's tier does not exist as far
    // as they are concerned. Applied in SQL rather than filtered afterwards so
    // the page size and the total both stay truthful — and, more importantly,
    // so a material they could never be charged for never reaches their basket
    // in the first place. Without this the failure surfaces at checkout, on a
    // line that had no price to begin with.
    qb.andWhere(
      `EXISTS (
         SELECT 1 FROM product_pricing pp
          WHERE pp.product_id = p.id
            AND pp.tier = :callerTier
            AND pp.effective_from <= NOW()
            AND (pp.effective_until IS NULL OR pp.effective_until > NOW())
       )`,
      { callerTier: tierForRole(caller.role) },
    );

    // Factories & free facilities buy from WAREHOUSE STOCK: a material with no
    // available stock in THEIR governorate's active warehouses is unbuyable, so
    // it must not appear. Available = quantity − reserved > 0. Citizens and
    // institutions are not stock-gated (they are not buying from a warehouse in
    // the same way). A material never synced to Odoo has no stock lines, so it
    // is correctly excluded here too. This is why the graded-buyer catalogue is
    // NOT cached (see getAllMaterials / getProductsByCategory) — stock is live.
    if (stockGated) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM warehouse_inventory wi
           INNER JOIN warehouses w ON w.id = wi.warehouse_id
           WHERE wi.odoo_product_id = p.odoo_product_id
             AND w.state = 'ACTIVE'
             ${provinceId ? 'AND w.province_id = :stockProvince' : ''}
             AND (COALESCE(wi.quantity, 0) - COALESCE(wi.reserved_quantity, 0)) > 0
         )`,
        provinceId ? { stockProvince: provinceId } : {},
      );
    }

    if (allowed) {
      qb.andWhere('p.categoryId IN (:...allowed)', { allowed });
    }
    if (filters.categoryId) {
      qb.andWhere('p.categoryId = :categoryId', { categoryId: filters.categoryId });
    }
    if (filters.categoryIds?.length) {
      qb.andWhere('p.categoryId IN (:...filterCategoryIds)', {
        filterCategoryIds: filters.categoryIds,
      });
    }
    if (filters.search) {
      qb.andWhere('p.name ILIKE :search', { search: `%${filters.search}%` })
        .setParameter('prefixSearch', `${filters.search}%`);
    }

    // Price range filter — correct pagination via EXISTS on current tier price.
    if (query.price_min != null || query.price_max != null) {
      qb.andWhere(
        new Brackets((b) => {
          b.where(
            `EXISTS (SELECT 1 FROM product_pricing pp
               WHERE pp.product_id = p.id
                 AND pp.tier = :priceTier
                 AND pp.effective_from <= NOW()
                 AND (pp.effective_until IS NULL OR pp.effective_until > NOW())
                 ${query.price_min != null ? 'AND pp.price >= :priceMin' : ''}
                 ${query.price_max != null ? 'AND pp.price <= :priceMax' : ''})`,
            {
              priceTier: tierForRole(caller.role),
              priceMin: query.price_min,
              priceMax: query.price_max,
            },
          );
        }),
      );
    }

    if (filters.search) {
      // Autocomplete-friendly: prefix matches first, then the requested order.
      // Aliased CASE (raw form 500s under the paginated join).
      qb.addSelect('CASE WHEN p.name ILIKE :prefixSearch THEN 0 ELSE 1 END', 'name_rank')
        .orderBy('name_rank', 'ASC');
      if (query.sort === 'name') {
        qb.addOrderBy('p.name', query.order.toUpperCase() as 'ASC' | 'DESC');
      } else {
        qb.addOrderBy('p.createdAt', 'DESC');
      }
    } else if (query.sort === 'name') {
      qb.orderBy('p.name', query.order.toUpperCase() as 'ASC' | 'DESC');
    } else {
      qb.orderBy('p.createdAt', 'DESC');
    }

    qb.skip((query.page - 1) * query.limit).take(query.limit);

    const [products, total] = await qb.getManyAndCount();
    const [pricingMap, offerMap, unitLabels, conditionLabels] = await Promise.all([
      this.pricingForProducts(products.map((p) => p.id)),
      this.activeOffersForProducts(products.map((p) => p.id), caller.role),
      this.units.labelMap(),
      this.conditionsService.labelMapFor(products.map((p) => p.id)),
    ]);

    // For a factory / free facility, how much of each material is available in
    // their governorate's active warehouses — the quantity they can order right
    // now. Empty for citizens / institutions (not stock-gated).
    const provinceStock = stockGated
      ? await this.provinceStockForProducts(products, provinceId)
      : undefined;

    const callerTier = tierForRole(caller.role);
    let items = products.map((p) =>
      this.mapProduct(
        p,
        pricingMap.get(p.id) ?? [],
        offerMap.get(p.id),
        unitLabels,
        callerTier,
        conditionLabels,
        provinceStock,
      ),
    );

    // Price sort applied on the materialised page. Each item now carries a
    // single `price` — the caller's own tier — so the sort reads that directly
    // instead of picking a column out of a four-tier matrix.
    if (query.sort === 'price') {
      items = items.sort((a, b) => {
        const pa = (a as { price?: number }).price ?? 0;
        const pb = (b as { price?: number }).price ?? 0;
        return query.order === 'desc' ? pb - pa : pa - pb;
      });
    }

    return { items, total };
  }

  /**
   * Total AVAILABLE quantity (quantity − reserved, floored at 0) of each material
   * across the buyer's governorate's ACTIVE warehouses, keyed by odooProductId.
   *
   * One grouped query for the whole page — the number a factory / free facility
   * sees next to a material is exactly what it could order there right now, the
   * same governorate scope the gating and the availability view use. Materials
   * never synced to Odoo (no `odooProductId`) contribute nothing.
   */
  private async provinceStockForProducts(
    products: Product[],
    provinceId: string | null,
  ): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const odooIds = products
      .map((p) => p.odooProductId)
      .filter((x): x is number => x != null);
    if (!odooIds.length) return map;

    const qb = this.inventoryRepo
      .createQueryBuilder('wi')
      .innerJoin('wi.warehouse', 'w')
      .select('wi.odooProductId', 'pid')
      .addSelect(
        'SUM(GREATEST(COALESCE(wi.quantity, 0) - COALESCE(wi.reservedQuantity, 0), 0))',
        'available',
      )
      .where('wi.odooProductId IN (:...odooIds)', { odooIds })
      .andWhere('w.state = :active', { active: WarehouseState.ACTIVE })
      .groupBy('wi.odooProductId');
    if (provinceId) qb.andWhere('w.provinceId = :provinceId', { provinceId });

    const rows = await qb.getRawMany<{ pid: number; available: string }>();
    for (const r of rows) map.set(Number(r.pid), Number(r.available));
    return map;
  }

  /**
   * Rank offers by the saving the buyer ACTUALLY receives.
   *
   * The old ordering was `o.discountPercentage DESC` — a column an
   * administrator types by hand, free to disagree with the two prices either
   * side of it. Ranking a "biggest discounts" list by it ranks by somebody's
   * arithmetic instead of by the money saved.
   *
   * The comparison is per material against ITS OWN price, which is the point:
   * 100 → 50 is half off and must outrank 200 → 190, even though 190 is the
   * larger number and 10 the larger absolute cut. Comparing offers to each
   * other would invert exactly that.
   *
   * Done in SQL rather than by sorting the page in memory, because the page is
   * cut by LIMIT/OFFSET before it is read: sorting afterwards would order 20
   * arbitrary rows and call it the top 20.
   *
   * The base price is matched on the offer's OWN condition — an offer on
   * "excellent" is a discount off the excellent price, not off the cheapest
   * grade — and `IS NOT DISTINCT FROM` is what makes that hold when both sides
   * are NULL, which `=` does not.
   */
  private orderByRealDiscount(
    qb: SelectQueryBuilder<Offer>,
    _callerRole: Role | null,
  ): void {
    // Rank by the stored `discountPercentage`, which now IS the real saving.
    //
    // This used to compute the saving on the fly by joining the price sheet and
    // taking (price - offer_price) / price. Two things made that both broken and
    // unnecessary. Broken: the offer no longer holds an `offer_price` column at
    // all — it holds an amount and an audience — so the expression referenced a
    // field that does not exist, and the whole "biggest offers" list threw the
    // moment it was sorted. Unnecessary: `discountPercentage` is no longer a
    // number an administrator types (the redesign removed that field); it is
    // DERIVED against the dearest tier the offer faces and kept in step on every
    // create, edit and price change. So the column is exactly the figure the
    // join was recomputing, and ranking by it needs no join — the same way
    // `searchOffers` already orders.
    qb.orderBy('o.discountPercentage', 'DESC')
      // Ties broken by recency so the order is stable across pages.
      .addOrderBy('o.createdAt', 'DESC');
  }

  /**
   * Constrain an offer query to the audience the caller belongs to.
   *
   * A buyer must see only buyer offers and a seller only seller offers — the
   * price move runs the opposite way for each, so applying the wrong side's
   * offer does not shrink a price, it inverts it. The role filter alone cannot
   * guarantee this once `targetRoles` may be null, so the audience is pinned
   * explicitly. Guests belong to neither side; they are left to the role
   * clause, which already limits them to untargeted offers.
   */
  private applyAudienceFilter(
    qb: { andWhere: (clause: string, params?: Record<string, unknown>) => unknown },
    callerRole: Role | null,
  ): void {
    const audience = callerRole ? audienceForRole(callerRole) : null;
    if (audience) qb.andWhere('o.audience = :audience', { audience });
  }

  private baseOfferQuery(allowed: string[] | null, activeOnly: boolean, callerRole: Role | null) {
    const qb = this.offerRepo
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.product', 'p')
      .where('p.isActive = :active', { active: true });

    // Role targeting: untargeted offers are public; targeted ones only show to
    // the listed roles (guests see untargeted only).
    if (callerRole) {
      qb.andWhere('(o.targetRoles IS NULL OR :callerRole = ANY(o.targetRoles))', { callerRole });
    } else {
      qb.andWhere('o.targetRoles IS NULL');
    }
    // …and by audience, so a seller offer never surfaces on a buyer's list even
    // if its roles were cleared to null. See `activeOffersForProducts`.
    this.applyAudienceFilter(qb, callerRole);

    // Role-specific OVERRIDES general: when a live offer targeted at the caller's
    // role exists for the same material + grade, the general one is hidden so the
    // buyer sees only the specific. Done in SQL (a correlated NOT EXISTS) so it
    // holds across pagination — collapsing a page in memory would leak a general
    // offer onto one page and its overriding specific onto another. Guests never
    // see targeted offers, so the override cannot apply to them.
    if (callerRole) {
      qb.andWhere(
        `NOT (
           o.role_specific = false
           AND EXISTS (
             SELECT 1 FROM offers o2
             WHERE o2.product_id = o.product_id
               AND o2.condition_code IS NOT DISTINCT FROM o.condition_code
               AND o2.audience = o.audience
               AND o2.role_specific = true
               AND o2.is_active = true
               AND o2.valid_from <= NOW()
               AND (o2.valid_until IS NULL OR o2.valid_until > NOW())
               AND :callerRole = ANY(o2.target_roles)
           )
         )`,
        { callerRole },
      );
    }

    if (activeOnly) {
      qb.andWhere('o.isActive = true')
        .andWhere('o.validFrom <= NOW()')
        .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())');
    }
    if (allowed) {
      qb.andWhere('p.categoryId IN (:...allowed)', { allowed });
    }
    return qb;
  }

  private async assertCategoryAllowed(caller: Caller, categoryId: string) {
    const allowed = await this.assignedCategories.getAssignedCategoryIds(caller.id, caller.role);
    if (allowed && !allowed.includes(categoryId)) {
      throw new CategoryNotAccessibleException();
    }
  }

  private async productCounts(categoryIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (categoryIds.length === 0) return map;

    const rows = await this.productRepo
      .createQueryBuilder('p')
      .select('p.categoryId', 'categoryId')
      .addSelect('COUNT(*)', 'count')
      .where('p.categoryId IN (:...ids)', { ids: categoryIds })
      .andWhere('p.isActive = true')
      .groupBy('p.categoryId')
      .getRawMany();

    for (const r of rows) map.set(r.categoryId, Number(r.count));
    return map;
  }

  private async pricingForProducts(productIds: string[]): Promise<Map<string, ProductPricing[]>> {
    const map = new Map<string, ProductPricing[]>();
    if (productIds.length === 0) return map;

    const rows = await this.pricingRepo.find({
      where: { productId: In(productIds) },
    });
    for (const row of rows) {
      const list = map.get(row.productId) ?? [];
      list.push(row);
      map.set(row.productId, list);
    }
    return map;
  }

  /**
   * EVERY live offer per material, not the best one.
   *
   * This used to keep the first row per product and drop the rest, which was
   * wrong the moment a graded material could carry more than one offer: a
   * factory may hold a separate offer on "excellent", "good" and "poor" of the
   * same material, and collapsing them to one meant two of the three prices
   * simply never reached the buyer — silently, and differently depending on
   * which row the sort happened to put first.
   *
   * Still ordered best-discount-first, so `[0]` remains the headline offer for
   * callers that want a single number.
   */
  private async activeOffersForProducts(
    productIds: string[],
    callerRole: Role | null,
  ): Promise<Map<string, Offer[]>> {
    const map = new Map<string, Offer[]>();
    if (productIds.length === 0) return map;

    const qb = this.offerRepo
      .createQueryBuilder('o')
      .where('o.productId IN (:...ids)', { ids: productIds })
      .andWhere(
        callerRole
          ? '(o.targetRoles IS NULL OR :callerRole = ANY(o.targetRoles))'
          : 'o.targetRoles IS NULL',
        { callerRole },
      )
      .andWhere('o.isActive = true')
      .andWhere('o.validFrom <= NOW()')
      .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())')
      .orderBy('o.discountPercentage', 'DESC');

    // Filter by AUDIENCE, not only by role. The role clause above is not enough
    // on its own: an offer can end up with `targetRoles = NULL` (an edit that
    // clears them), and null reads as "everyone" — so a SELLERS offer would
    // match a buyer here and then be applied as an INCREASE to their price,
    // because the reader multiplies by the offer's own audience direction. The
    // same guard is on every other offer read path; this one had been missed.
    this.applyAudienceFilter(qb, callerRole);

    const rows = this.preferRoleSpecificOffers(await qb.getMany());

    for (const o of rows) {
      const list = map.get(o.productId) ?? [];
      list.push(o);
      map.set(o.productId, list);
    }
    return map;
  }

  /**
   * Collapse a set of offers so a role-SPECIFIC offer overrides the GENERAL one
   * for the same material + grade.
   *
   * Every row handed in already reaches the caller's role. Within one material
   * and grade, if a role-specific offer is present it hides the general one — the
   * buyer is shown the specific, not the general — while a group with no specific
   * keeps its general row untouched. This is the in-memory twin of the NOT EXISTS
   * override in `baseOfferQuery`, for the applied (non-paginated) read path.
   */
  private preferRoleSpecificOffers(offers: Offer[]): Offer[] {
    if (offers.length < 2) return offers;
    const key = (o: Offer) => `${o.productId}:${o.conditionCode ?? ''}`;
    const hasSpecific = new Set<string>();
    for (const o of offers) if (o.roleSpecific) hasSpecific.add(key(o));
    if (hasSpecific.size === 0) return offers;
    return offers.filter((o) => o.roleSpecific || !hasSpecific.has(key(o)));
  }

  private mapCategory(c: WasteCategory, productCount?: number) {
    return {
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      image: c.imageCategoryURL || null,
      ...(productCount != null ? { product_count: productCount } : {}),
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    };
  }

  /** Rows of a tier that are currently effective. */
  private liveRows(prices: ProductPricing[], tier: PricingTier): ProductPricing[] {
    const now = Date.now();
    return prices.filter(
      (p) =>
        p.tier === tier &&
        new Date(p.effectiveFrom).getTime() <= now &&
        (!p.effectiveUntil || new Date(p.effectiveUntil).getTime() > now),
    );
  }

  /**
   * The headline price for ONE tier — the reader's own, and no other.
   *
   * A listing must never hand a citizen a factory's price (or the reverse), so
   * the payload carries a single number for the caller's role rather than the
   * whole four-tier matrix it used to. A flat tier (citizen / company) has one
   * price; a graded tier (factory / free facility) is priced per condition, so
   * the headline is the LOWEST condition price ("starting from") and the full
   * breakdown travels in `condition_prices`.
   */
  private tierHeadlinePrice(prices: ProductPricing[], tier: PricingTier): number {
    const rows = this.liveRows(prices, tier);
    const graded =
      tier === PricingTier.FACTORY || tier === PricingTier.FREE_FACILITY;
    if (graded) {
      const g = rows.filter((p) => p.conditionCode);
      return g.length ? Math.min(...g.map((r) => Number(r.price))) : 0;
    }
    const flat = rows
      .filter((p) => !p.conditionCode)
      .sort(
        (a, b) =>
          new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime(),
      )[0];
    return flat ? Number(flat.price) : 0;
  }

  /**
   * The price a buyer of this tier would pay WITHOUT any offer.
   *
   * This is what an offer is a discount *from*, so it is what the discount has
   * to be measured against. A graded tier is priced per condition, so the base
   * depends on which condition the offer names — an offer on "excellent" is not
   * a discount off the cheapest grade.
   */
  private basePriceFor(
    prices: ProductPricing[],
    tier: PricingTier,
    conditionCode?: string | null,
  ): number | null {
    const rows = this.liveRows(prices, tier).filter((r) =>
      conditionCode ? r.conditionCode === conditionCode : !r.conditionCode,
    );
    if (!rows.length) return null;
    // Newest effective row wins, matching how `mapPricing` reads a flat price.
    const current = rows.sort(
      (a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime(),
    )[0];
    return Number(current.price);
  }

  /**
   * How much this offer actually takes off, as a fraction of the material's own
   * price for this buyer.
   *
   * Computed, never read from `offer.discountPercentage`: that column is typed
   * in by an administrator and is free to disagree with the two numbers either
   * side of it. Sorting a "biggest discounts" list by a field somebody typed
   * ranks by their arithmetic rather than by the saving the buyer receives.
   *
   * Returns null when there is no base price to compare against — a material
   * priced for nobody has no discount, and 0 would sort it among the honest
   * small ones.
   */
  private realDiscount(
    offer: Offer,
    prices: ProductPricing[],
    tier: PricingTier,
  ): number | null {
    const base = this.basePriceFor(prices, tier, offer.conditionCode);
    if (base == null || base <= 0) return null;
    const amount = Number(offer.amount);
    if (!Number.isFinite(amount)) return null;
    // Against THIS tier's own price. The offer holds an amount, so the same
    // offer is a bigger proportion to a buyer paying less — which is exactly
    // what a "biggest offers" list should be ranking by.
    return offerPercentage(base, amount);
  }

  /**
   * What this reader actually pays, with the offer applied.
   *
   * Computed from their own list price rather than read off the offer: one
   * offer reaches two roles priced differently, so a stored final price could
   * only ever have been right for one of them.
   */
  private offeredPriceFor(
    offer: Offer,
    prices: ProductPricing[],
    tier: PricingTier,
  ): number | null {
    const base = this.basePriceFor(prices, tier, offer.conditionCode);
    if (base == null) return null;
    return priceAfterOffer(base, Number(offer.amount), offer.audience);
  }

  private mapProduct(
    p: Product,
    prices: ProductPricing[],
    liveOffers?: Offer[],
    unitLabels?: Map<string, string>,
    callerTier?: PricingTier,
    conditionLabels?: Map<string, string>,
    provinceStock?: Map<number, number>,
  ) {
    const offers = liveOffers ?? [];
    const tier = callerTier ?? PricingTier.INDIVIDUAL;

    // Every live offer, each with the grade it applies to and when it ends.
    // A graded material can carry one per condition, and the buyer needs all of
    // them: which grade is discounted is the whole decision.
    const offerRows = offers
      .map((o) => ({
        condition: o.conditionCode ?? null,
        condition_label: o.conditionCode
          ? (conditionLabels?.get(o.conditionCode) ?? o.conditionCode)
          : null,
        // Both numbers, and the amount between them. An offer is a CHANGE of
        // price: showing only the new figure answers "what does it cost" while
        // losing "what did it cost", which is what makes the change legible.
        base_price: this.basePriceFor(prices, tier, o.conditionCode),
        offer_price: this.offeredPriceFor(o, prices, tier),
        amount: Number(o.amount),
        direction: o.audience === OfferAudience.SELLERS ? 'INCREASE' : 'DECREASE',
        discount_percentage: this.realDiscount(o, prices, tier),
        // Null means open-ended. The client needs the difference: a countdown
        // on an offer that never ends is a lie, and no date on one that does is
        // worse.
        valid_until: o.validUntil ?? null,
      }))
      .sort((a, b) => (b.discount_percentage ?? -1) - (a.discount_percentage ?? -1));

    const bestOffer = offers[0];
    // Factories / free facilities buy by grade: expose each condition of the
    // product with its own price for THEIR tier.
    const isGradedTier =
      callerTier === PricingTier.FACTORY || callerTier === PricingTier.FREE_FACILITY;
    const conditionPrices = isGradedTier
      ? this.liveRows(prices, callerTier)
          .filter((r) => r.conditionCode)
          .map((r) => ({
            condition: r.conditionCode,
            condition_label: conditionLabels?.get(r.conditionCode!) ?? r.conditionCode,
            price: Number(r.price),
          }))
          .sort((a, b) => a.price - b.price)
      : undefined;

    // The offer as ONE tidy object, or null — never a spray of `offer_*` fields
    // across the row. When the material carries no live offer for this reader,
    // `offer` is null and NO offer keys appear at all. A graded material can hold
    // one offer per grade; the headline (biggest real saving) fills the object,
    // and `by_condition` carries the rest only when there is more than one.
    const headline = offerRows[0];
    const offer = headline
      ? {
          old_price: headline.base_price,
          new_price: headline.offer_price,
          amount: headline.amount,
          percentage: headline.discount_percentage,
          currency: 'SYP',
          expires_at: headline.valid_until,
          // The full per-grade breakdown lives INSIDE the one offer object, so a
          // graded material's several offers are organised, not scattered.
          by_condition: offerRows,
        }
      : null;

    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      image: p.imageURL ?? null,
      category_id: p.categoryId,
      category_name: p.category?.name ?? null,
      unit_type: p.unitType,
      unit_label: unitLabels?.get(p.unitType) ?? p.unitType,
      // ONLY the caller's own price (see tierHeadlinePrice) — never the whole
      // tier matrix, so a user token can never read a factory's number.
      price: this.tierHeadlinePrice(prices, tier),
      currency: 'SYP',
      // One object when there is an offer, null when there is not.
      offer,
      // Grades and their prices only for the graded buyers (factory / free
      // facility) AND only when the material actually has grades — a citizen or
      // institution never sees grades, and a graded material with none carries
      // no `condition_prices` key at all.
      ...(conditionPrices && conditionPrices.length ? { condition_prices: conditionPrices } : {}),
      // Quantity available across the buyer's governorate warehouses — factories
      // and free facilities only. The key is present only for them (provinceStock
      // is undefined for citizens / institutions), so it never leaks a stock
      // figure to a role that does not buy from a warehouse.
      ...(provinceStock
        ? { province_available: provinceStock.get(p.odooProductId ?? -1) ?? 0 }
        : {}),
      created_at: p.createdAt,
    };
  }

  /**
   * A guest is told an offer EXISTS; they are not told what it is worth.
   *
   * The figure is withheld for two reasons. It is commercially sensitive — the
   * discount off a factory price is the factory price minus one subtraction,
   * and any visitor could read a competitor's whole sheet in one call. And it
   * would be a number the visitor never actually gets: price is a function of
   * the buyer's tier, so the amount shown to nobody-in-particular is the amount
   * shown to nobody. "There is an offer here" is what makes them register;
   * "20% off 7" is what makes them stop needing to.
   *
   * The flag lives INSIDE the mapper on purpose. A separate guest mapper is one
   * more thing a future call site can forget to use; a rule at the single point
   * where offers become JSON cannot be bypassed by forgetting.
   */
  /**
   * The list price each of these offers moves FROM, for the caller's own tier.
   *
   * The offers list used to hand back an amount with nothing to apply it to, so
   * a client could show "5 off" but not what the material actually costs — and
   * the only way for it to find out was another request per offer. One query
   * for the whole page instead, keyed by material and grade.
   *
   * Empty for a guest: they are not on any tier, so there is no price of theirs
   * to move.
   */
  private async basePricesForOffers(
    rows: Offer[],
    tier: PricingTier | null,
  ): Promise<Map<string, number>> {
    const byKey = new Map<string, number>();
    if (!tier || !rows.length) return byKey;

    const prices = await this.pricingRepo.find({
      where: { productId: In([...new Set(rows.map((o) => o.productId))]), tier },
    });
    // Grouped by product FIRST. `basePriceFor` filters only by tier and grade,
    // not by product, because it was written to receive one material's price
    // rows; handed the whole page's rows it would match another material's
    // price for the same tier and grade — so every ungraded offer would show
    // whichever product's row happened to be newest. Each offer must be priced
    // against its OWN material's sheet.
    const byProduct = new Map<string, ProductPricing[]>();
    for (const p of prices) {
      const list = byProduct.get(p.productId) ?? [];
      list.push(p);
      byProduct.set(p.productId, list);
    }
    for (const o of rows) {
      const base = this.basePriceFor(byProduct.get(o.productId) ?? [], tier, o.conditionCode);
      if (base != null) byKey.set(`${o.productId}:${o.conditionCode ?? ''}`, base);
    }
    return byKey;
  }

  private mapOffer(o: Offer, isGuest = false, basePrice?: number | null) {
    return {
      offer_id: o.id,
      product_id: o.productId,
      product_name: o.product?.name ?? null,
      product_image: o.product?.imageURL ?? null,
      ...(isGuest
        ? { requires_login: true }
        : {
            // The offer holds an AMOUNT, not a final price — one offer reaches
            // two roles priced differently, so a single stored price could only
            // ever have been right for one of them. `base_price` and
            // `offer_price` are filled in by the caller that knows the reader's
            // own tier; the amount and its direction are true regardless.
            amount: Number(o.amount),
            direction:
              o.audience === OfferAudience.SELLERS ? 'INCREASE' : 'DECREASE',
            discount_percentage: Number(o.discountPercentage),
            ...(basePrice != null
              ? {
                  base_price: basePrice,
                  offer_price: priceAfterOffer(
                    basePrice, Number(o.amount), o.audience,
                  ),
                }
              : {}),
          }),
      audience: o.audience,
      condition: o.conditionCode ?? null,
      description: o.description ?? null,
      valid_from: o.validFrom,
      valid_until: o.validUntil ?? null,
    };
  }

  private emptyList(key: 'categories' | 'offers', page: number, limit: number) {
    return {
      [key]: [],
      pagination: buildPagination(0, page, limit),
    };
  }
}
