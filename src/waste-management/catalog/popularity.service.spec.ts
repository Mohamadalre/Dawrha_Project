import { Role } from '@src/user/enums/role.enum';
import { PricingTier } from '../enums/pricing-tier.enum';
import { PopularityService } from './popularity.service';

/**
 * What "most ordered" is allowed to mean.
 *
 * The trap this service exists to avoid is ranking by summed quantity. Quantity
 * is recorded in each material's OWN unit, so 5,000 kg of PET and 300 units of a
 * battery are not two sizes of the same thing — and sorting on that number lets
 * whichever unit happens to produce bigger figures sit at the top of the list
 * permanently, no matter what people are actually ordering.
 */
describe('PopularityService', () => {
  let lineRepo: any;
  let productRepo: any;
  let sellability: any;
  let units: any;
  let cache: any;
  let service: PopularityService;

  /** Raw rows as the aggregate query returns them (strings, as pg gives them). */
  let rankedRows: any[];
  let qb: any;

  const product = (id: string, name: string, unit = 'KG') => ({
    id,
    name,
    imageURL: null,
    categoryId: 'c1',
    category: { name: 'Plastics' },
    unitType: unit,
    isActive: true,
  });

  beforeEach(() => {
    rankedRows = [];
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => rankedRows),
    };
    lineRepo = { createQueryBuilder: jest.fn(() => qb) };
    productRepo = { find: jest.fn(async () => []) };
    sellability = { sellableIds: jest.fn(async (ids: string[]) => new Set(ids)) };
    units = { labelMap: jest.fn(async () => new Map([['KG', 'كغم'], ['PIECE', 'قطعة']])) };
    cache = { get: jest.fn(async () => null), set: jest.fn() };

    service = new PopularityService(lineRepo, productRepo, sellability, units, cache);
  });

  it('ranks by ORDER COUNT, not by summed quantity', async () => {
    // Battery appears in more orders; PET has a far bigger number attached to it
    // only because it is weighed in kilograms.
    rankedRows = [
      { productId: 'battery', orderCount: '40', totalQuantity: '300' },
      { productId: 'pet', orderCount: '9', totalQuantity: '50000' },
    ];
    productRepo.find.mockResolvedValue([
      product('battery', 'Battery', 'PIECE'),
      product('pet', 'PET'),
    ]);

    const res = await service.mostOrdered(Role.FACTORY, 10);

    expect(res.materials.map((m) => m.id)).toEqual(['battery', 'pet']);
    expect(qb.orderBy).toHaveBeenCalledWith('COUNT(DISTINCT p.orderId)', 'DESC');
  });

  it('still reports each material\'s quantity in its own unit', async () => {
    rankedRows = [{ productId: 'pet', orderCount: '9', totalQuantity: '50000' }];
    productRepo.find.mockResolvedValue([product('pet', 'PET')]);

    const res = await service.mostOrdered(Role.FACTORY, 10);

    // Meaningful WITHIN a material, which is the only place it is used.
    expect(res.materials[0]).toMatchObject({
      total_quantity: 50000,
      unit_type: 'KG',
      unit_label: 'كغم',
      order_count: 9,
    });
  });

  it('excludes lines from parts nobody ever supplied', async () => {
    rankedRows = [];
    await service.mostOrdered(Role.FACTORY, 10);

    // A refused, expired or cancelled part delivered nothing, so counting it
    // would measure intent rather than trade.
    expect(qb.where).toHaveBeenCalledWith(
      'p.status NOT IN (:...dead)',
      { dead: ['REJECTED', 'EXPIRED', 'CANCELLED'] },
    );
  });

  it('drops a material the reader\'s tier cannot buy', async () => {
    rankedRows = [
      { productId: 'pet', orderCount: '40', totalQuantity: '100' },
      { productId: 'copper', orderCount: '30', totalQuantity: '80' },
    ];
    productRepo.find.mockResolvedValue([
      product('pet', 'PET'),
      product('copper', 'Copper'),
    ]);
    // Copper is priced for factories only; a citizen reading this list cannot
    // buy it, and recommending it would send them to a dead end.
    sellability.sellableIds.mockResolvedValue(new Set(['pet']));

    const res = await service.mostOrdered(Role.CITIZEN, 10);

    expect(res.materials.map((m) => m.id)).toEqual(['pet']);
  });

  it('asks sellability for the READER\'S tier', async () => {
    rankedRows = [{ productId: 'pet', orderCount: '1', totalQuantity: '1' }];
    productRepo.find.mockResolvedValue([product('pet', 'PET')]);

    await service.mostOrdered(Role.EXTERNAL_PARTNER, 5);

    expect(sellability.sellableIds).toHaveBeenCalledWith(
      ['pet'], PricingTier.FREE_FACILITY,
    );
  });

  it('over-fetches so the tier filter cannot shrink the page below the limit', async () => {
    rankedRows = [{ productId: 'pet', orderCount: '1', totalQuantity: '1' }];
    productRepo.find.mockResolvedValue([product('pet', 'PET')]);

    await service.mostOrdered(Role.FACTORY, 10);

    // Taking exactly `limit` rows would return fewer than asked whenever any of
    // the top materials is not priced for this tier.
    expect(qb.limit).toHaveBeenCalledWith(40);
  });

  it('never returns more than the caller asked for', async () => {
    rankedRows = Array.from({ length: 30 }, (_, i) => ({
      productId: `p${i}`, orderCount: String(30 - i), totalQuantity: '10',
    }));
    productRepo.find.mockResolvedValue(
      rankedRows.map((r) => product(r.productId, r.productId)),
    );

    const res = await service.mostOrdered(Role.FACTORY, 5);

    expect(res.materials).toHaveLength(5);
  });

  it('caches per TIER, so one role never receives another role\'s list', async () => {
    rankedRows = [{ productId: 'pet', orderCount: '1', totalQuantity: '1' }];
    productRepo.find.mockResolvedValue([product('pet', 'PET')]);

    await service.mostOrdered(Role.FACTORY, 10);

    // The list differs by tier because unbuyable materials are dropped. A shared
    // cache entry would serve a citizen the factory list — including materials
    // they cannot be charged for.
    expect(cache.set).toHaveBeenCalledWith(
      'products', 'most-ordered:FACTORY:10', expect.anything(),
    );
  });

  it('returns nothing at all when no order has been placed yet', async () => {
    rankedRows = [];

    const res = await service.mostOrdered(Role.CITIZEN, 10);

    expect(res.materials).toEqual([]);
    expect(productRepo.find).not.toHaveBeenCalled();
  });
});
