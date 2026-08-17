import { StatisticsService } from './statistics.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * Unit tests for StatisticsService — aggregation logic with mocked repos.
 */
describe('StatisticsService', () => {
  let service: StatisticsService;
  let accountRepo: any;
  let truckRepo: any;
  let assignmentRepo: any;
  let warehouseRepo: any;
  let categoryRepo: any;
  let productRepo: any;
  let offerRepo: any;
  let suggestionRepo: any;
  let odooSync: any;
  let odoo: any;

  beforeEach(() => {
    accountRepo = { count: jest.fn(), createQueryBuilder: jest.fn() };
    truckRepo = { count: jest.fn(), createQueryBuilder: jest.fn() };
    assignmentRepo = { createQueryBuilder: jest.fn() };
    warehouseRepo = { count: jest.fn() };
    categoryRepo = { count: jest.fn() };
    productRepo = { count: jest.fn() };
    offerRepo = { count: jest.fn() };
    suggestionRepo = { count: jest.fn() };
    odooSync = { enqueueSyncFleet: jest.fn().mockResolvedValue(undefined) };
    odoo = { countDeliveryTrucks: jest.fn().mockResolvedValue(0) };

    service = new StatisticsService(
      accountRepo,
      truckRepo,
      assignmentRepo,
      warehouseRepo,
      categoryRepo,
      productRepo,
      offerRepo,
      suggestionRepo,
      odooSync,
      odoo,
    );
  });

  it('getAccountStats counts totals, roles, statuses and verification', async () => {
    accountRepo.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7); // total, verified
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValueOnce([
          { role: Role.CITIZEN, count: '5' },
          { role: Role.ADMIN, count: '2' },
        ])
        .mockResolvedValueOnce([{ status: 'ACTIVE', count: '7' }]),
    };
    accountRepo.createQueryBuilder.mockReturnValue(qb);

    const res = await service.getAccountStats();

    expect(res.total).toBe(10);
    expect(res.verified).toBe(7);
    expect(res.unverified).toBe(3);
    expect(res.by_role[Role.CITIZEN]).toBe(5);
    expect(res.by_role[Role.ADMIN]).toBe(2);
    expect(res.by_role[Role.FACTORY]).toBe(0); // defaulted
    expect(res.by_status.ACTIVE).toBe(7);
  });

  it('counts collection from the mirror and delivery live from Odoo', async () => {
    truckRepo.count.mockResolvedValue(4); // collection fleet (mirror)
    odoo.countDeliveryTrucks.mockResolvedValue(2); // delivery fleet (Odoo master)
    assignmentRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ count: '3' }),
    });
    truckRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ status: 'active', count: '4' }]),
    });

    const res = await service.getTruckStats();

    // total is the two fleets combined; assignment/status are the collection
    // fleet's alone (delivery has no backend assignment).
    expect(res.total).toBe(6);
    expect(res.by_type.collection).toBe(4);
    expect(res.by_type.delivery).toBe(2);
    expect(res.assigned_to_drivers).toBe(3);
    expect(res.unassigned).toBe(1);
    expect(res.by_status.active).toBe(4);
  });

  it('falls back to the collection fleet when Odoo is unreachable', async () => {
    truckRepo.count.mockResolvedValue(4);
    odoo.countDeliveryTrucks.mockRejectedValue(new Error('odoo down'));
    assignmentRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ count: '3' }),
    });
    truckRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ status: 'active', count: '4' }]),
    });

    const res = await service.getTruckStats();

    expect(res.total).toBe(4);
    expect(res.by_type.delivery).toBe(0);
  });

  it('getWarehouseStats counts active vs inactive', async () => {
    warehouseRepo.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3); // total, active
    const res = await service.getWarehouseStats();
    expect(res).toEqual({ total: 5, active: 3, inactive: 2 });
  });

  it('getCatalogStats aggregates catalogue counts', async () => {
    categoryRepo.count.mockResolvedValue(6);
    productRepo.count.mockResolvedValueOnce(20).mockResolvedValueOnce(18); // products, active
    offerRepo.count.mockResolvedValue(4);
    suggestionRepo.count.mockResolvedValue(2);

    const res = await service.getCatalogStats();

    expect(res).toEqual({
      categories: 6,
      products: 20,
      active_products: 18,
      offers: 4,
      pending_suggestions: 2,
    });
  });
});
