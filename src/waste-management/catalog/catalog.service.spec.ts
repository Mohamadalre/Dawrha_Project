import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Role } from '@src/user/enums/role.enum';

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

  const makeQb = () => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([]),
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
    conditionsService = {
      labelMap: jest.fn(async () => new Map([['EXCELLENT', 'ممتازة'], ['UNGRADED', 'غير مفروزة']])),
      active: jest.fn(async () => []),
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
    );
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
  });
});
