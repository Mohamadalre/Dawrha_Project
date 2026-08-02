import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { PricingTier, tierForRole } from '../enums/pricing-tier.enum';
import { AssignedCategoryProvider } from '@src/waste-management/common/providers/assigned-category.provider';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';
import { BuyerProfileService } from '@src/waste-management/common/providers/buyer-profile.service';
import { WarehouseState } from '@src/warehouse/enums/warehouse-state.enum';
import {
  CategoryNotAccessibleException,
  CategoryNotFoundException,
  MaterialsNotApplicableException,
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
  ) {}

  // ---------------------------------------------------------------------------
  // Material grades — always scoped to ONE material.
  // A global picker would offer a buyer grades the material in front of them
  // does not have, and an ungraded material would appear to have some.
  // ---------------------------------------------------------------------------
  async getConditions(productId: string) {
    const conditions = await this.conditionsService.activeForProduct(productId);
    return {
      conditions: conditions.map((c) => ({
        id: c.id,
        code: c.code,
        name_en: c.nameEn,
        name_ar: c.nameAr,
        sort_order: c.sortOrder,
      })),
    };
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
  private buyableProductExistsSql(caller: Caller | null): string {
    const priced = `AND EXISTS (
             SELECT 1 FROM product_pricing pp
              WHERE pp.product_id = pr.id
                AND pp.tier = :callerTier
                AND pp.effective_from <= NOW()
                AND (pp.effective_until IS NULL OR pp.effective_until > NOW())
           )`;
    return `SELECT 1 FROM products pr
              WHERE pr.category_id = c.id
                AND pr.is_active = true
                ${this.buyingTier(caller) ? priced : ''}`;
  }

  /** The tier a caller buys at, or null when they do not buy at all. */
  private buyingTier(caller: Caller | null): PricingTier | null {
    if (!caller || caller.role === Role.ADMIN) return null;
    return tierForRole(caller.role);
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
    const cacheParts = `${this.scopeFor(caller)}:${query.page}:${query.limit}:${query.search ?? ''}:${query.sort}:${query.order}`;
    const cached = await this.cache.get<CategoryListResult>('categories', cacheParts);
    if (cached) return cached;

    const qb = this.categoryRepo
      .createQueryBuilder('c')
      .where('c.isActive = :active', { active: true })
      // An empty category is a dead end: the buyer taps it, gets nothing, and
      // learns only that the catalogue is unfinished. "Empty" means empty FOR
      // THEM — a category whose materials are all priced for another tier has
      // nothing in it they could buy, and the emptiness test is the same one the
      // material list applies, so tapping a category always lands on the
      // materials that were counted for it.
      .andWhere(`EXISTS (${this.buyableProductExistsSql(caller)})`);
    this.applyTierParam(qb, caller);

    if (query.search) {
      qb.andWhere('c.name ILIKE :search', { search: `%${query.search}%` })
        .setParameter('prefixSearch', `${query.search}%`);
    }

    const sortColumn = query.sort === 'created_at' ? 'c.createdAt' : 'c.name';
    if (query.search) {
      // Autocomplete-friendly: names STARTING with the typed text rank first.
      qb.orderBy('CASE WHEN c.name ILIKE :prefixSearch THEN 0 ELSE 1 END', 'ASC')
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
    await this.cache.set('categories', cacheParts, result);
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

    const cacheParts = `${this.scopeFor(caller)}:${categoryId}:${query.page}:${query.limit}:${query.sort}:${query.order}:${query.price_min ?? ''}:${query.price_max ?? ''}`;
    const cached = await this.cache.get<ProductListResult>('products', cacheParts);
    if (cached) return cached;

    const category = await this.categoryRepo.findOne({ where: { id: categoryId } });
    if (!category) throw new CategoryNotFoundException();

    const { items, total } = await this.queryProducts(caller, query, { categoryId });

    const result = {
      category: this.mapCategory(category),
      products: items,
      pagination: buildPagination(total, query.page, query.limit),
    };
    await this.cache.set('products', cacheParts, result);
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
      qb.orderBy('o.discountPercentage', 'DESC');
    }

    qb.skip((query.page - 1) * query.limit).take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    const result = {
      offers: rows.map((o) => this.mapOffer(o, !caller)),
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

    const qb = this.baseOfferQuery(allowed, true, caller?.role ?? null)
      .andWhere('p.name ILIKE :q', { q: `%${query.query}%` })
      .setParameter('qPrefix', `${query.query}%`);

    if (query.category_id) {
      qb.andWhere('p.categoryId = :cid', { cid: query.category_id });
    }

    // Autocomplete-friendly: offers on products starting with the text first.
    qb.orderBy('CASE WHEN p.name ILIKE :qPrefix THEN 0 ELSE 1 END', 'ASC')
      .addOrderBy('o.discountPercentage', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      offers: rows.map((o) => this.mapOffer(o, !caller)),
      pagination: buildPagination(total, query.page, query.limit),
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
      .andWhere('w.isActive = true');

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

  /** Live per-condition prices of the caller's tier (graded tiers only). */
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
      .andWhere('pp.conditionCode IS NOT NULL')
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .getMany();
    return new Map(rows.map((r) => [r.conditionCode!, Number(r.price)]));
  }

  /**
   * Groups the per-condition stock rows by warehouse: each warehouse shows its
   * grades (condition, quantity, availability and — for graded-tier callers —
   * the price of that grade).
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
        price: priceByCondition.get(r.conditionCode) ?? null,
      });
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
      qb.orderBy('CASE WHEN p.name ILIKE :prefixSearch THEN 0 ELSE 1 END', 'ASC');
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

    const callerTier = tierForRole(caller.role);
    let items = products.map((p) =>
      this.mapProduct(
        p,
        pricingMap.get(p.id) ?? [],
        offerMap.get(p.id),
        unitLabels,
        callerTier,
        conditionLabels,
      ),
    );

    // Price sort applied on the materialised page using the caller's own tier.
    if (query.sort === 'price') {
      const tier = tierForRole(caller.role);
      const key = tier.toLowerCase() as
        | 'individual'
        | 'company'
        | 'factory'
        | 'free_facility';
      items = items.sort((a, b) => {
        const pricingA = a.pricing as unknown as Record<string, number>;
        const pricingB = b.pricing as unknown as Record<string, number>;
        const pa = pricingA[key] || 0;
        const pb = pricingB[key] || 0;
        return query.order === 'desc' ? pb - pa : pa - pb;
      });
    }

    return { items, total };
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

  private async activeOffersForProducts(
    productIds: string[],
    callerRole: Role | null,
  ): Promise<Map<string, Offer>> {
    const map = new Map<string, Offer>();
    if (productIds.length === 0) return map;

    const rows = await this.offerRepo
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
      .orderBy('o.discountPercentage', 'DESC')
      .getMany();

    for (const o of rows) {
      if (!map.has(o.productId)) map.set(o.productId, o); // best offer per product
    }
    return map;
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

  private mapPricing(prices: ProductPricing[]) {
    const flat = (tier: PricingTier): number => {
      const current = this.liveRows(prices, tier)
        .filter((p) => !p.conditionCode)
        .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())[0];
      return current ? Number(current.price) : 0;
    };
    // Graded tiers are priced per condition — the headline number is the
    // LOWEST condition price ("starting from"); the full matrix is in
    // condition_prices on the product payload.
    const minGraded = (tier: PricingTier): number => {
      const rows = this.liveRows(prices, tier).filter((p) => p.conditionCode);
      if (rows.length === 0) return 0;
      return Math.min(...rows.map((r) => Number(r.price)));
    };

    return {
      individual: flat(PricingTier.INDIVIDUAL),
      company: flat(PricingTier.COMPANY),
      factory: minGraded(PricingTier.FACTORY),
      free_facility: minGraded(PricingTier.FREE_FACILITY),
      currency: 'JOD',
    };
  }

  private mapProduct(
    p: Product,
    prices: ProductPricing[],
    bestOffer?: Offer,
    unitLabels?: Map<string, string>,
    callerTier?: PricingTier,
    conditionLabels?: Map<string, string>,
  ) {
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

    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      image: p.imageURL ?? null,
      category_id: p.categoryId,
      category_name: p.category?.name ?? null,
      unit_type: p.unitType,
      unit_label: unitLabels?.get(p.unitType) ?? p.unitType,
      pricing: this.mapPricing(prices),
      has_offer: !!bestOffer,
      offer_price: bestOffer ? Number(bestOffer.offerPrice) : null,
      discount_percentage: bestOffer ? Number(bestOffer.discountPercentage) : null,
      ...(conditionPrices ? { condition_prices: conditionPrices } : {}),
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
  private mapOffer(o: Offer, isGuest = false) {
    return {
      offer_id: o.id,
      product_id: o.productId,
      product_name: o.product?.name ?? null,
      product_image: o.product?.imageURL ?? null,
      ...(isGuest
        ? { requires_login: true }
        : {
            offer_price: Number(o.offerPrice),
            discount_percentage: Number(o.discountPercentage),
          }),
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
