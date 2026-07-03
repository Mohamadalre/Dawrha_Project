import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Role } from '@src/user/enums/role.enum';

describe('CatalogService', () => {
  let service: CatalogService;
  let categoryRepo: any;
  let productRepo: any;
  let pricingRepo: any;
  let offerRepo: any;
  let assigned: any;
  let cache: any;

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
    getRawMany: jest.fn().mockResolvedValue([]),
  });

  beforeEach(() => {
    categoryRepo = { createQueryBuilder: jest.fn(() => makeQb()) };
    productRepo = { createQueryBuilder: jest.fn(() => makeQb()) };
    pricingRepo = { find: jest.fn().mockResolvedValue([]) };
    offerRepo = { createQueryBuilder: jest.fn(() => makeQb()) };
    assigned = { getAssignedCategoryIds: jest.fn() };
    cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), invalidate: jest.fn() };

    service = new CatalogService(categoryRepo, productRepo, pricingRepo, offerRepo, assigned, cache);
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
});
