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
  ) {}

  // ---------------------------------------------------------------------------
  // Material conditions (active only — grade pickers for factory/free-facility)
  // ---------------------------------------------------------------------------
  async getConditions() {
    const conditions = await this.conditionsService.active();
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
    // Only INSTITUTIONS are scoped to their assigned categories; everyone else
    // (guest / citizen / factory / free-facility / admin) shares the full cache.
    return caller?.role === Role.INSTITUTIONS ? `acc:${caller.id}` : 'all';
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
    const cacheParts = `all:${query.page}:${query.limit}:${query.search ?? ''}:${query.sort}:${query.order}`;
    const cached = await this.cache.get<CategoryListResult>('categories', cacheParts);
    if (cached) return cached;

    const qb = this.categoryRepo
      .createQueryBuilder('c')
      .where('c.isActive = :active', { active: true });

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
      offers: rows.map((o) => this.mapOffer(o)),
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
      offers: rows.map((o) => this.mapOffer(o)),
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
    const product = await this.productRepo.findOne({ where: { id: productId, isActive: true } });
    if (!product) throw new ProductNotFoundException();

    // Category-restricted roles must not see products outside their assignment.
    const allowed = await this.allowedCategoryIds(caller);
    if (allowed && !allowed.includes(product.categoryId)) {
      throw new ProductNotFoundException();
    }

    const [conditionLabels, priceByCondition] = await Promise.all([
      this.conditionsService.labelMap(),
      this.callerConditionPrices(product.id, caller),
    ]);

    // Never pushed to Odoo yet → no stock lines can exist for it.
    if (!product.odooProductId) {
      return this.mapAvailability(product, [], conditionLabels, priceByCondition);
    }

    const rows = await this.inventoryRepo
      .createQueryBuilder('inv')
      .innerJoinAndSelect('inv.warehouse', 'w')
      .where('inv.odooProductId = :odooProductId', { odooProductId: product.odooProductId })
      .andWhere('w.isActive = true')
      .orderBy('w.name', 'ASC')
      .getMany();

    return this.mapAvailability(product, rows, conditionLabels, priceByCondition);
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
        condition_label: conditionLabels.get(r.conditionCode) ?? r.conditionCode,
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
      .where('p.isActive = :active', { active: true });

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
      this.conditionsService.labelMap(),
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

  private mapOffer(o: Offer) {
    return {
      offer_id: o.id,
      product_id: o.productId,
      product_name: o.product?.name ?? null,
      product_image: o.product?.imageURL ?? null,
      offer_price: Number(o.offerPrice),
      discount_percentage: Number(o.discountPercentage),
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
