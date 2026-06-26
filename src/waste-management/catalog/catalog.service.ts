import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { PricingTier, tierForRole } from '../enums/pricing-tier.enum';
import { AssignedCategoryProvider } from '@src/waste-management/common/providers/assigned-category.provider';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { buildPagination, PaginationMeta } from '@src/waste-management/common/dto/pagination.dto';
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
    private readonly assignedCategories: AssignedCategoryProvider,
    private readonly cache: CatalogCacheService,
  ) {}

  /**
   * Cache scope: unrestricted roles (CITIZEN/ADMIN) share one cache entry ('all');
   * restricted roles are cached per account because their assigned categories differ.
   * Derived from role alone so a cache HIT needs no DB lookup.
   */
  private scopeFor(caller: Caller): string {
    // Only INSTITUTIONS are scoped to their assigned categories; everyone else
    // (citizen / factory / free-facility / admin) shares the full-catalogue cache.
    return caller.role === Role.INSTITUTIONS ? `acc:${caller.id}` : 'all';
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------
  async getCategories(caller: Caller, query: CategoryQueryDto) {
    const cacheParts = `${this.scopeFor(caller)}:${query.page}:${query.limit}:${query.search ?? ''}:${query.sort}:${query.order}`;
    const cached = await this.cache.get<CategoryListResult>('categories', cacheParts);
    if (cached) return cached;

    const allowed = await this.assignedCategories.getAssignedCategoryIds(caller.id, caller.role);

    const qb = this.categoryRepo
      .createQueryBuilder('c')
      .where('c.isActive = :active', { active: true });

    if (allowed) {
      if (allowed.length === 0) {
        return this.emptyList('categories', query.page, query.limit);
      }
      qb.andWhere('c.id IN (:...allowed)', { allowed });
    }

    if (query.search) {
      qb.andWhere('c.name ILIKE :search', { search: `%${query.search}%` });
    }

    const sortColumn = query.sort === 'created_at' ? 'c.createdAt' : 'c.name';
    qb.orderBy(sortColumn, query.order.toUpperCase() as 'ASC' | 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

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
    if (!category) throw new NotFoundException('Category not found');

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
  async getOffers(caller: Caller, query: OfferQueryDto) {
    const cacheParts = `${this.scopeFor(caller)}:${query.page}:${query.limit}:${query.active_only}:${query.sort}`;
    const cached = await this.cache.get<OfferListResult>('offers', cacheParts);
    if (cached) return cached;

    const allowed = await this.assignedCategories.getAssignedCategoryIds(caller.id, caller.role);
    if (allowed && allowed.length === 0) {
      return this.emptyList('offers', query.page, query.limit);
    }

    const qb = this.baseOfferQuery(allowed, query.active_only);

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

  async searchOffers(caller: Caller, query: OfferSearchQueryDto) {
    const allowed = await this.assignedCategories.getAssignedCategoryIds(caller.id, caller.role);
    if (allowed && allowed.length === 0) {
      return this.emptyList('offers', query.page, query.limit);
    }

    const qb = this.baseOfferQuery(allowed, true).andWhere('p.name ILIKE :q', {
      q: `%${query.query}%`,
    });

    if (query.category_id) {
      qb.andWhere('p.categoryId = :cid', { cid: query.category_id });
    }

    qb.orderBy('o.discountPercentage', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      offers: rows.map((o) => this.mapOffer(o)),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Shared internals
  // ---------------------------------------------------------------------------

  /** Core product query used by category listing, search, and price-range. */
  private async queryProducts(
    caller: Caller,
    query: ProductQueryDto,
    filters: { categoryId?: string; search?: string },
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
    if (filters.search) {
      qb.andWhere('p.name ILIKE :search', { search: `%${filters.search}%` });
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

    if (query.sort === 'name') {
      qb.orderBy('p.name', query.order.toUpperCase() as 'ASC' | 'DESC');
    } else {
      qb.orderBy('p.createdAt', 'DESC');
    }

    qb.skip((query.page - 1) * query.limit).take(query.limit);

    const [products, total] = await qb.getManyAndCount();
    const pricingMap = await this.pricingForProducts(products.map((p) => p.id));
    const offerMap = await this.activeOffersForProducts(products.map((p) => p.id));

    let items = products.map((p) =>
      this.mapProduct(p, pricingMap.get(p.id) ?? [], offerMap.get(p.id)),
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

  private baseOfferQuery(allowed: string[] | null, activeOnly: boolean) {
    const qb = this.offerRepo
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.product', 'p')
      .where('p.isActive = :active', { active: true });

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
      throw new NotFoundException('Category not available for this account');
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

  private async activeOffersForProducts(productIds: string[]): Promise<Map<string, Offer>> {
    const map = new Map<string, Offer>();
    if (productIds.length === 0) return map;

    const rows = await this.offerRepo
      .createQueryBuilder('o')
      .where('o.productId IN (:...ids)', { ids: productIds })
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
      description: c.description ?? '',
      image: c.imageCategoryURL,
      ...(productCount != null ? { product_count: productCount } : {}),
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    };
  }

  private mapPricing(prices: ProductPricing[]) {
    const now = Date.now();
    const pick = (tier: PricingTier): number => {
      const current = prices
        .filter(
          (p) =>
            p.tier === tier &&
            new Date(p.effectiveFrom).getTime() <= now &&
            (!p.effectiveUntil || new Date(p.effectiveUntil).getTime() > now),
        )
        .sort(
          (a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime(),
        )[0];
      return current ? Number(current.price) : 0;
    };

    return {
      individual: pick(PricingTier.INDIVIDUAL),
      company: pick(PricingTier.COMPANY),
      factory: pick(PricingTier.FACTORY),
      free_facility: pick(PricingTier.FREE_FACILITY),
      currency: 'JOD',
    };
  }

  private mapProduct(p: Product, prices: ProductPricing[], bestOffer?: Offer) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      image: p.imageURL ?? null,
      category_id: p.categoryId,
      category_name: p.category?.name ?? null,
      unit_type: p.unitType,
      unit_label: p.unitType === 'KG' ? 'كغم' : 'قطعة',
      pricing: this.mapPricing(prices),
      has_offer: !!bestOffer,
      offer_price: bestOffer ? Number(bestOffer.offerPrice) : null,
      discount_percentage: bestOffer ? Number(bestOffer.discountPercentage) : null,
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
      description: o.description ?? '',
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
