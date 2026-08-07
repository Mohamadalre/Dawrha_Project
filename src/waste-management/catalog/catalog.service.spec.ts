import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Role } from '@src/user/enums/role.enum';
import { PricingTier } from '../enums/pricing-tier.enum';
import { OfferAudience } from '../enums/offer-audience.enum';

describe('CatalogService', () => {
  let service: CatalogService;
  let categoryRepo: any;
  let productRepo: any;
  let pricingRepo: any;
  let offerRepo: any;
  let inventoryRepo: any;
  let assigned: any;
  let cache: any;
  let units: any;
  let conditionsService: any;
  let buyerProfiles: any;
  let effectivePrice: any;

  const makeQb = () => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
  });

  beforeEach(() => {
    categoryRepo = { createQueryBuilder: jest.fn(() => makeQb()), find: jest.fn().mockResolvedValue([]) };
    productRepo = { createQueryBuilder: jest.fn(() => makeQb()), findOne: jest.fn() };
    pricingRepo = { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn(() => makeQb()) };
    offerRepo = { createQueryBuilder: jest.fn(() => makeQb()) };
    inventoryRepo = { createQueryBuilder: jest.fn(() => makeQb()) };
    assigned = { getAssignedCategoryIds: jest.fn(), getSelectedCategoryIds: jest.fn() };
    cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), invalidate: jest.fn() };
    units = {
      labelMap: jest.fn(async () => new Map([['KG', 'كغم'], ['PIECE', 'قطعة']])),
      active: jest.fn(async () => []),
    };
    // Labels are keyed by (material, code) now — the same code means different
    // things for different materials.
    conditionsService = {
      labelMapFor: jest.fn(async () => new Map([
        ['p1:EXCELLENT', 'ممتازة'],
        ['UNGRADED', 'غير مفروزة'],
      ])),
      activeForProduct: jest.fn(async () => []),
      hasConditions: jest.fn(async () => false),
    };

    // Availability is reported for the buyer's OWN governorate, so the service
    // now needs to know which one that is. Default: a factory in province 'pv1'.
    buyerProfiles = {
      provinceForBuyer: jest.fn(async () => 'pv1'),
      forAccount: jest.fn(async () => ({ profileId: 'fp1', provinceId: 'pv1' })),
    };

    effectivePrice = {
      effectivePrice: jest.fn(async () => null),
    };

    service = new CatalogService(
      categoryRepo,
      productRepo,
      pricingRepo,
      offerRepo,
      inventoryRepo,
      assigned,
      cache,
      units,
      conditionsService,
      buyerProfiles,
      effectivePrice,
    );
  });

  describe('searchOffers (by material name OR id, role price)', () => {
    const runSearch = (term: string) => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      offerRepo.createQueryBuilder.mockReturnValue(qb);
      assigned.getAssignedCategoryIds.mockResolvedValue(null);
      pricingRepo.find.mockResolvedValue([]);
      return service
        .searchOffers({ id: 'u1', role: Role.FACTORY }, { query: term, page: 1, limit: 10 } as any)
        .then(() => qb);
    };

    it('matches the id as well when the term is a UUID', async () => {
      const qb = await runSearch('11111111-1111-4111-8111-111111111111');
      const clause = (qb.andWhere as jest.Mock).mock.calls
        .map((c) => String(c[0]))
        .find((c) => c.includes('p.id = :term'));
      expect(clause).toBeDefined();
    });

    it('matches by NAME only for a plain term', async () => {
      const qb = await runSearch('plastic');
      const idClause = (qb.andWhere as jest.Mock).mock.calls
        .map((c) => String(c[0]))
        .find((c) => c.includes('p.id = :term'));
      expect(idClause).toBeUndefined();
    });
  });

  describe('getConditions (per-grade stock + role price + offer)', () => {
    const FACTORY_CALLER = { id: 'u1', role: Role.FACTORY };

    it('returns a clear message when the material has NO conditions', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', categoryId: 'c1', odooProductId: 5 });
      assigned.getAssignedCategoryIds.mockResolvedValue(null);
      conditionsService.activeForProduct.mockResolvedValue([]);

      const res: any = await service.getConditions(FACTORY_CALLER, 'p1');

      expect(res.has_conditions).toBe(false);
      expect(res.message).toMatch(/no conditions/i);
      expect(res.conditions).toEqual([]);
    });

    it('returns per-grade available stock (own governorate) + price with offer applied', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', categoryId: 'c1', odooProductId: 5 });
      assigned.getAssignedCategoryIds.mockResolvedValue(null);
      conditionsService.activeForProduct.mockResolvedValue([
        { id: 'ce', code: 'EXCELLENT', nameEn: 'Excellent', nameAr: 'ممتاز', sortOrder: 1 },
      ]);
      buyerProfiles.provinceForBuyer.mockResolvedValue('pv1');
      const invQb = makeQb();
      invQb.getMany.mockResolvedValue([
        { conditionCode: 'EXCELLENT', quantity: '100', reservedQuantity: '30' }, // 70 available
      ]);
      inventoryRepo.createQueryBuilder.mockReturnValue(invQb);
      effectivePrice.effectivePrice.mockResolvedValue({
        basePrice: 10,
        offer: { amount: '2', audience: 'BUYERS' },
        price: 8,
      });

      const res: any = await service.getConditions(FACTORY_CALLER, 'p1');

      expect(res.has_conditions).toBe(true);
      const c = res.conditions[0];
      expect(c.available).toBe(70);
      expect(c.base_price).toBe(10);
      expect(c.price).toBe(8); // offer applied
      expect(c.has_offer).toBe(true);
      expect(c.discount_percentage).toBe(20);
      // The price came from the token role (FACTORY), never a fixed tier.
      expect(effectivePrice.effectivePrice).toHaveBeenCalledWith('p1', Role.FACTORY, 'EXCELLENT');
    });

    it('does not scope stock/price for a flat-tier caller (citizen)', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', categoryId: 'c1', odooProductId: 5 });
      assigned.getAssignedCategoryIds.mockResolvedValue(null);
      conditionsService.activeForProduct.mockResolvedValue([
        { id: 'ce', code: 'EXCELLENT', nameEn: 'Excellent', nameAr: 'ممتاز', sortOrder: 1 },
      ]);

      const res: any = await service.getConditions({ id: 'u2', role: Role.CITIZEN }, 'p1');

      // Grade metadata only — no price/stock leaked to a flat buyer.
      expect(res.conditions[0]).not.toHaveProperty('price');
      expect(res.conditions[0]).not.toHaveProperty('available');
      expect(effectivePrice.effectivePrice).not.toHaveBeenCalled();
    });
  });

  it('getCategories returns the cached value without touching the DB', async () => {
    const cached = { categories: [{ id: 'c1' }], pagination: {} };
    cache.get.mockResolvedValue(cached);

    const res = await service.getCategories({ id: 'u1', role: Role.CITIZEN }, { page: 1, limit: 10, sort: 'name', order: 'asc' } as any);

    expect(res).toBe(cached);
    expect(assigned.getAssignedCategoryIds).not.toHaveBeenCalled();
  });

  it('getOffers returns the cached value on a hit', async () => {
    const cached = { offers: [{ offer_id: 'o1' }], pagination: {} };
    cache.get.mockResolvedValue(cached);

    const res = await service.getOffers({ id: 'u1', role: Role.CITIZEN }, { page: 1, limit: 10, active_only: true, sort: 'discount' } as any);
    expect(res).toBe(cached);
  });

  it('getAllMaterials returns the cached page without querying', async () => {
    const cached = { products: [{ id: 'p1' }], pagination: {} };
    cache.get.mockResolvedValue(cached);

    const res = await service.getAllMaterials(
      { id: 'u1', role: Role.CITIZEN },
      { page: 1, limit: 10, sort: 'name', order: 'asc', search: 'pl' } as any,
    );

    expect(res).toBe(cached);
    // Cache key must vary with the name search + price band, or two different
    // searches would collide on one entry.
    const key = cache.get.mock.calls[0][1];
    expect(key).toContain(':all:');
    expect(key).toContain('pl');
  });

  it('getCategories serves a GUEST (null caller) without category scoping', async () => {
    cache.get.mockResolvedValue(null);

    const res: any = await service.getCategories(
      null,
      { page: 1, limit: 10, sort: 'name', order: 'asc' } as any,
    );

    // Guests are never scoped to assigned categories.
    expect(assigned.getAssignedCategoryIds).not.toHaveBeenCalled();
    expect(res.categories).toEqual([]);
  });

  it('getOffers serves a GUEST (null caller) without scoping', async () => {
    cache.get.mockResolvedValue(null);

    const res: any = await service.getOffers(
      null,
      { page: 1, limit: 10, active_only: true, sort: 'discount' } as any,
    );

    expect(assigned.getAssignedCategoryIds).not.toHaveBeenCalled();
    expect(res.offers).toEqual([]);
  });

  it('getCategories returns empty for an institution with no assigned categories', async () => {
    cache.get.mockResolvedValue(null);
    assigned.getAssignedCategoryIds.mockResolvedValue([]); // restricted, none assigned

    const res: any = await service.getCategories(
      { id: 'i1', role: Role.INSTITUTIONS },
      { page: 1, limit: 10, sort: 'name', order: 'asc' } as any,
    );

    expect(res.categories).toEqual([]);
    expect(res.pagination.total_count).toBe(0);
  });

  /**
   * An empty category is a dead end: the buyer taps it, gets nothing, and learns
   * only that the catalogue is unfinished. "Empty" has to mean empty FOR THEM —
   * a category whose materials are all priced for another tier holds nothing
   * they could buy — and the test has to be part of the SQL, because a filter
   * applied after fetching would leave the total counting rows the caller can
   * never page to.
   */
  it('getCategories hides categories holding nothing this buyer can buy', async () => {
    cache.get.mockResolvedValue(null);
    assigned.getAssignedCategoryIds.mockResolvedValue(null);
    const qb = makeQb();
    categoryRepo.createQueryBuilder.mockReturnValue(qb);

    await service.getCategories(
      { id: 'f1', role: Role.FACTORY },
      { page: 1, limit: 10, sort: 'name', order: 'asc' } as any,
    );

    const existsClause = qb.andWhere.mock.calls
      .map((c: any[]) => String(c[0]))
      .find((c: string) => c.includes('EXISTS'));
    expect(existsClause).toBeDefined();
    expect(existsClause).toContain('product_pricing');
    expect(qb.setParameter).toHaveBeenCalledWith('callerTier', PricingTier.FACTORY);
  });

  /**
   * Switching off a CATEGORY must switch off its materials.
   *
   * It did not. `GET /categories` hid the category and every material inside it
   * went on being listed, searched and bought — so an admin who withdrew a
   * whole material line found it still on sale, and would only discover that
   * from an order they could not fulfil. Deactivating each material by hand is
   * a rule that gets half-applied the first time somebody is in a hurry.
   */
  it('hides the materials of a deactivated category', async () => {
    cache.get.mockResolvedValue(null);
    assigned.getAssignedCategoryIds.mockResolvedValue(null);
    const qb = makeQb();
    productRepo.createQueryBuilder.mockReturnValue(qb);

    await service.getProductsByPrice(
      { id: 'f1', role: Role.FACTORY },
      { page: 1, limit: 10, sort: 'name', order: 'asc' } as any,
    );

    const clauses = [
      ...qb.where.mock.calls.map((c: any[]) => String(c[0])),
      ...qb.andWhere.mock.calls.map((c: any[]) => String(c[0])),
    ];
    expect(clauses).toContain('c.isActive = :active');
  });

  it('getCategories does NOT apply the price test for an admin', async () => {
    // An admin is not buying, so "priced for my tier" is not a question they
    // have — applying it would hide categories they are meant to administer.
    cache.get.mockResolvedValue(null);
    assigned.getAssignedCategoryIds.mockResolvedValue(null);
    const qb = makeQb();
    categoryRepo.createQueryBuilder.mockReturnValue(qb);

    await service.getCategories(
      { id: 'a1', role: Role.ADMIN },
      { page: 1, limit: 10, sort: 'name', order: 'asc' } as any,
    );

    const existsClause = qb.andWhere.mock.calls
      .map((c: any[]) => String(c[0]))
      .find((c: string) => c.includes('EXISTS'));
    expect(existsClause).not.toContain('product_pricing');
    expect(qb.setParameter).not.toHaveBeenCalledWith('callerTier', expect.anything());
  });

  it('caches the category list PER TIER, never under one shared key', async () => {
    // The list now differs by tier. A shared 'all' entry would serve one role
    // the other's categories — the same bug already fixed on the product list.
    cache.get.mockResolvedValue(null);
    assigned.getAssignedCategoryIds.mockResolvedValue(null);

    await service.getCategories(
      { id: 'f1', role: Role.FACTORY },
      { page: 1, limit: 10, sort: 'name', order: 'asc' } as any,
    );

    const key = String(cache.set.mock.calls[0][1]);
    expect(key).toContain('tier:FACTORY');
    expect(key.startsWith('all:')).toBe(false);
  });

  it('getProductsByCategory forbids a category not assigned to an institution', async () => {
    assigned.getAssignedCategoryIds.mockResolvedValue(['c1']); // only c1

    await expect(
      service.getProductsByCategory(
        { id: 'i1', role: Role.INSTITUTIONS },
        'c2',
        { page: 1, limit: 10, sort: 'name', order: 'asc' } as any,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('getMyMaterials', () => {
    const factory = { id: 'f1', role: Role.FACTORY };

    it('rejects roles that have no onboarding material step (e.g. CITIZEN)', async () => {
      assigned.getSelectedCategoryIds.mockResolvedValue(null);

      await expect(
        service.getMyMaterials({ id: 'u1', role: Role.CITIZEN }, { page: 1, limit: 10 } as any),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('returns an empty result when the account selected no categories', async () => {
      assigned.getSelectedCategoryIds.mockResolvedValue([]);

      const res: any = await service.getMyMaterials(factory, { page: 1, limit: 10 } as any);

      expect(res.categories).toEqual([]);
      expect(res.products).toEqual([]);
      expect(res.pagination.total_count).toBe(0);
    });

    it('lists the selected categories and their products', async () => {
      assigned.getSelectedCategoryIds.mockResolvedValue(['c1', 'c2']);
      assigned.getAssignedCategoryIds.mockResolvedValue(null); // factory: unrestricted catalogue
      categoryRepo.find.mockResolvedValue([
        { id: 'c1', name: 'Plastic', imageCategoryURL: '', createdAt: new Date(), updatedAt: new Date() },
      ]);

      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([
        [{ id: 'p1', name: 'PET', categoryId: 'c1', unitType: 'KG', createdAt: new Date() }],
        1,
      ]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      const res: any = await service.getMyMaterials(factory, { page: 1, limit: 10 } as any);

      expect(res.categories).toHaveLength(1);
      expect(res.categories[0]).toMatchObject({ id: 'c1', name: 'Plastic' });
      expect(res.products).toHaveLength(1);
      expect(res.products[0]).toMatchObject({ id: 'p1', unit_label: 'كغم' });
      // The product query was scoped to the selected categories.
      expect(qb.andWhere).toHaveBeenCalledWith(
        'p.categoryId IN (:...filterCategoryIds)',
        { filterCategoryIds: ['c1', 'c2'] },
      );
    });
  });

  describe('getProductAvailability', () => {
    const factory = { id: 'f1', role: Role.FACTORY };

    it('throws NotFound when the product does not exist or is inactive', async () => {
      productRepo.findOne.mockResolvedValue(null);
      assigned.getAssignedCategoryIds.mockResolvedValue(null);

      await expect(service.getProductAvailability(factory, 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns zero stock without querying inventory when the product is not synced to Odoo', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'PET', unitType: 'KG', categoryId: 'c1', odooProductId: null });
      assigned.getAssignedCategoryIds.mockResolvedValue(null);

      const res: any = await service.getProductAvailability(factory, 'p1');

      expect(res.total_available).toBe(0);
      expect(res.in_stock).toBe(false);
      expect(res.warehouses).toEqual([]);
      expect(inventoryRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('aggregates per-warehouse availability (quantity - reserved, clamped at 0)', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'PET', unitType: 'KG', categoryId: 'c1', odooProductId: 7 });
      assigned.getAssignedCategoryIds.mockResolvedValue(null);

      const qb = makeQb();
      qb.getMany.mockResolvedValue([
        {
          warehouseId: 'w1',
          conditionCode: 'EXCELLENT',
          quantity: '100.000',
          reservedQuantity: '30.000',
          syncedAt: null,
          warehouse: { name: 'Amman', code: 'AMM', address: null },
        },
        {
          warehouseId: 'w2',
          conditionCode: 'UNGRADED',
          quantity: '10.000',
          reservedQuantity: '25.000', // over-reserved → clamps to 0
          syncedAt: null,
          warehouse: { name: 'Zarqa', code: 'ZRQ', address: 'st 5' },
        },
      ]);
      inventoryRepo.createQueryBuilder.mockReturnValue(qb);

      const res: any = await service.getProductAvailability(factory, 'p1');

      expect(res.total_available).toBe(70);
      expect(res.in_stock).toBe(true);
      expect(res.warehouses).toHaveLength(2);
      expect(res.warehouses[0]).toMatchObject({ warehouse_id: 'w1', available: 70 });
      expect(res.warehouses[0].conditions[0]).toMatchObject({
        condition: 'EXCELLENT',
        condition_label: 'ممتازة',
        quantity: 100,
        available: 70,
      });
      expect(res.warehouses[1]).toMatchObject({ warehouse_id: 'w2', available: 0 });
    });

    it('hides products outside an institution\'s assigned categories', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'PET', unitType: 'KG', categoryId: 'c9', odooProductId: 7 });
      assigned.getAssignedCategoryIds.mockResolvedValue(['c1']);

      await expect(
        service.getProductAvailability({ id: 'i1', role: Role.INSTITUTIONS }, 'p1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * Availability is reported for the buyer's OWN governorate.
     *
     * Allocation only ever matches a buyer to warehouses in their governorate,
     * so a nationwide figure answered a question nobody asked and misled on the
     * one they did: a factory saw 8,000 kg, ordered 5,000, and the allocator
     * found 900 within reach. The number shown before committing has to be the
     * number the order can actually be filled from.
     */
    it('counts only warehouses in the buyer\'s own governorate', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'PET', unitType: 'KG', categoryId: 'c1', odooProductId: 7 });
      assigned.getAssignedCategoryIds.mockResolvedValue(null);
      buyerProfiles.provinceForBuyer.mockResolvedValue('pv1');

      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      inventoryRepo.createQueryBuilder.mockReturnValue(qb);

      const res: any = await service.getProductAvailability(factory, 'p1');

      expect(qb.andWhere).toHaveBeenCalledWith(
        'w.provinceId = :provinceId', { provinceId: 'pv1' },
      );
      // And says so, because a client cannot tell a country-wide total from a
      // governorate one by looking at the number.
      expect(res.scope).toBe('PROVINCE');
      expect(res.province_id).toBe('pv1');
    });

    it('excludes a warehouse Odoo has put into closing or inactive', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'PET', unitType: 'KG', categoryId: 'c1', odooProductId: 7 });
      assigned.getAssignedCategoryIds.mockResolvedValue(null);
      buyerProfiles.provinceForBuyer.mockResolvedValue('pv1');

      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      inventoryRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getProductAvailability(factory, 'p1');

      // Its stock can never be allocated, so counting it would promise from a
      // shelf the order can never reach.
      expect(qb.andWhere).toHaveBeenCalledWith(
        'w.state = :active', { active: 'ACTIVE' },
      );
    });

    it('falls back to every warehouse when the buyer has no governorate yet', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1', name: 'PET', unitType: 'KG', categoryId: 'c1', odooProductId: 7 });
      assigned.getAssignedCategoryIds.mockResolvedValue(null);
      // Half-finished profile: narrowing to "nowhere" would report zero stock
      // for a catalogue that is perfectly well supplied.
      buyerProfiles.provinceForBuyer.mockResolvedValue(null);

      const qb = makeQb();
      qb.getMany.mockResolvedValue([]);
      inventoryRepo.createQueryBuilder.mockReturnValue(qb);

      const res: any = await service.getProductAvailability(factory, 'p1');

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        'w.provinceId = :provinceId', expect.anything(),
      );
      expect(res.scope).toBe('ALL');
    });
  });

  /**
   * The one thing that must hold for a visitor: no number that a registered
   * buyer would be quoted ever reaches them. Price is a function of the tier,
   * so a figure shown to nobody-in-particular is a figure nobody is charged.
   */
  describe('guest catalogue', () => {
    const PRODUCT = {
      id: 'p1',
      name: 'PET Bottles',
      description: 'Clear bottles',
      imageURL: 'x.png',
      categoryId: 'c1',
      category: { id: 'c1', name: 'Plastic' },
      unitType: 'KG',
      createdAt: new Date(),
    };

    it('returns no price of any kind, only that prices exist behind login', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[PRODUCT], 1]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.guestProducts({ page: 1, limit: 10 });

      const product = res.products[0];
      expect(product).toMatchObject({
        id: 'p1',
        name: 'PET Bottles',
        unit_label: 'كغم',
        requires_login: true,
      });
      // Nothing price-shaped survives — checked by key, so a field added to
      // the mapper later cannot slip a number through unnoticed.
      const keys = Object.keys(product);
      expect(keys.filter((k) => /price/.test(k))).toEqual(['price_hint']);
      expect(keys).not.toContain('pricing');
      expect(keys).not.toContain('condition_prices');
      expect(keys).not.toContain('discount_percentage');
    });

    it('only lists materials that are live-priced for SOME tier', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      await service.guestProducts({ page: 1, limit: 10 });

      // A material priced for no tier is suspended: nobody who registers could
      // buy it, so advertising it to a visitor promises what we cannot deliver.
      const sql = qb.andWhere.mock.calls.map((c) => String(c[0])).join(' ');
      expect(sql).toContain('product_pricing');
      expect(sql).toContain('effective_until IS NULL');
    });

    it('flags that an offer exists without saying what it is worth', async () => {
      const productQb = makeQb();
      productQb.getManyAndCount.mockResolvedValue([[PRODUCT], 1]);
      productRepo.createQueryBuilder.mockReturnValue(productQb);
      const offerQb = makeQb();
      offerQb.getRawMany.mockResolvedValue([{ productId: 'p1' }]);
      offerRepo.createQueryBuilder.mockReturnValue(offerQb);

      const res = await service.guestProducts({ page: 1, limit: 10 });

      expect(res.products[0].has_offer).toBe(true);
      expect(res.products[0]).not.toHaveProperty('offer_price');
    });

    it('hides the offer amount from a guest but shows it to a signed-in buyer', async () => {
      const offer = {
        id: 'o1',
        productId: 'p1',
        product: { name: 'PET', imageURL: null },
        // An AMOUNT, not a price: a factory listed at 10 pays 7.5, which is
        // 25% off — but the same 2.5 off a free facility listed at 5 would be
        // half. Only the reader's own tier can turn it into a price.
        audience: OfferAudience.BUYERS,
        amount: '2.5',
        discountPercentage: '20',
        conditionCode: null,
        description: null,
        validFrom: new Date(),
        validUntil: null,
      };
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[offer], 1]);
      offerRepo.createQueryBuilder.mockReturnValue(qb);
      // The FACTORY list price the amount is applied to.
      pricingRepo.find.mockResolvedValue([
        {
          productId: 'p1',
          tier: PricingTier.FACTORY,
          conditionCode: null,
          price: '10',
          effectiveFrom: new Date(Date.now() - 86_400_000),
          effectiveUntil: null,
        },
      ]);
      assigned.getAssignedCategoryIds.mockResolvedValue(null);

      const guest: any = await service.getOffers(null, {
        page: 1, limit: 10, active_only: true, sort: 'discount',
      } as any);
      expect(guest.offers[0].requires_login).toBe(true);
      expect(guest.offers[0]).not.toHaveProperty('offer_price');
      expect(guest.offers[0]).not.toHaveProperty('discount_percentage');

      const buyer: any = await service.getOffers(
        { id: 'u1', role: Role.FACTORY },
        { page: 1, limit: 10, active_only: true, sort: 'discount' } as any,
      );
      expect(buyer.offers[0].offer_price).toBe(7.5);
      expect(buyer.offers[0].discount_percentage).toBe(20);
    });

    it('prices each offer against ITS OWN material, not another’s', async () => {
      // Two ungraded offers on two materials with different factory prices. The
      // base-price lookup fetches both materials' rows in one query, so it must
      // key them by product — otherwise every ungraded offer gets whichever
      // row is globally newest, and a 200-price material is quoted a 10 base.
      const offerA = {
        id: 'oA', productId: 'pA', product: { name: 'A', imageURL: null },
        audience: OfferAudience.BUYERS, amount: '60', discountPercentage: '30',
        conditionCode: null, description: null, validFrom: new Date(), validUntil: null,
      };
      const offerB = {
        id: 'oB', productId: 'pB', product: { name: 'B', imageURL: null },
        audience: OfferAudience.BUYERS, amount: '2', discountPercentage: '20',
        conditionCode: null, description: null, validFrom: new Date(), validUntil: null,
      };
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[offerA, offerB], 2]);
      offerRepo.createQueryBuilder.mockReturnValue(qb);
      pricingRepo.find.mockResolvedValue([
        { productId: 'pA', tier: PricingTier.FACTORY, conditionCode: null, price: '200',
          effectiveFrom: new Date(Date.now() - 1000), effectiveUntil: null },
        { productId: 'pB', tier: PricingTier.FACTORY, conditionCode: null, price: '10',
          effectiveFrom: new Date(Date.now() - 1000), effectiveUntil: null },
      ]);
      assigned.getAssignedCategoryIds.mockResolvedValue(null);

      const res: any = await service.getOffers(
        { id: 'u1', role: Role.FACTORY },
        { page: 1, limit: 10, active_only: true, sort: 'discount' } as any,
      );

      const byId = Object.fromEntries(res.offers.map((o: any) => [o.offer_id, o]));
      // A against 200 → 140 left; B against 10 → 8 left. A base of 10 for A
      // (the cross-material leak) would give 0 here.
      expect(byId.oA.base_price).toBe(200);
      expect(byId.oA.offer_price).toBe(140);
      expect(byId.oB.base_price).toBe(10);
      expect(byId.oB.offer_price).toBe(8);
    });

    it('constrains a buyer’s offers to the BUYERS audience', async () => {
      // The role clause alone is not enough: an offer whose target_roles were
      // cleared to null reads as "everyone", so a SELLERS offer would show on a
      // factory's list and be applied as a price INCREASE. The audience must be
      // pinned in the query.
      const qb = makeQb();
      offerRepo.createQueryBuilder.mockReturnValue(qb);
      assigned.getAssignedCategoryIds.mockResolvedValue(null);

      await service.getOffers(
        { id: 'u1', role: Role.FACTORY },
        { page: 1, limit: 10, active_only: true, sort: 'discount' } as any,
      );

      const audienceClause = (qb.andWhere as jest.Mock).mock.calls.find(
        ([clause]) => String(clause).includes('o.audience'),
      );
      expect(audienceClause).toBeDefined();
      expect(audienceClause![1]).toEqual({ audience: OfferAudience.BUYERS });
    });

    it('constrains a seller’s offers to the SELLERS audience', async () => {
      const qb = makeQb();
      offerRepo.createQueryBuilder.mockReturnValue(qb);
      assigned.getAssignedCategoryIds.mockResolvedValue(null);

      await service.getOffers(
        { id: 'u1', role: Role.INSTITUTIONS },
        { page: 1, limit: 10, active_only: true, sort: 'discount' } as any,
      );

      const audienceClause = (qb.andWhere as jest.Mock).mock.calls.find(
        ([clause]) => String(clause).includes('o.audience'),
      );
      expect(audienceClause![1]).toEqual({ audience: OfferAudience.SELLERS });
    });

    it('refuses a material whose price list was withdrawn', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      const pricingQb = makeQb();
      pricingQb.getCount = jest.fn().mockResolvedValue(0);
      pricingRepo.createQueryBuilder.mockReturnValue(pricingQb);

      await expect(service.guestProductDetail('p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('names a material\'s grades without pricing them', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      const pricingQb = makeQb();
      pricingQb.getCount = jest.fn().mockResolvedValue(3);
      pricingRepo.createQueryBuilder.mockReturnValue(pricingQb);
      conditionsService.activeForProduct.mockResolvedValue([
        { code: 'EXCELLENT', nameEn: 'Excellent', nameAr: 'ممتازة' },
      ]);

      const res: any = await service.guestProductDetail('p1');

      expect(res.product.conditions).toEqual([
        { code: 'EXCELLENT', name_en: 'Excellent', name_ar: 'ممتازة' },
      ]);
      expect(res.product.conditions[0]).not.toHaveProperty('price');
    });
  });
});
