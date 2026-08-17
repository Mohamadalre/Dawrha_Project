import { DeliveryDispatchService } from './delivery-dispatch.service';

/**
 * Dispatch after delivery trucks left the backend mirror.
 *
 * The rewrite's contract: the candidate trucks are read LIVE from Odoo for the
 * warehouse's ODOO id (not from a local table that no longer holds them), while
 * the two signals that DO belong to the backend — "busy" and "recently used" —
 * are still derived from the backend's own trip rows, keyed by the Odoo truck id.
 */
describe('DeliveryDispatchService', () => {
  let warehouseRepo: any;
  let tripRepo: any;
  let odoo: any;
  let service: DeliveryDispatchService;

  const mkTripQB = (rows: any[]) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  });

  beforeEach(() => {
    warehouseRepo = { findOne: jest.fn() };
    tripRepo = {
      find: jest.fn().mockResolvedValue([]), // no busy trucks by default
      createQueryBuilder: jest.fn(() => mkTripQB([])), // no recent trips by default
    };
    odoo = {
      fetchDeliveryTrucksForWarehouse: jest.fn(),
      // Default: every candidate truck has an available driver.
      fetchTrucksWithAvailableDriver: jest.fn(async (ids: number[]) => ids),
    };
    service = new DeliveryDispatchService(warehouseRepo, tripRepo, odoo);
  });

  it('returns nothing for a warehouse that was never synced to Odoo', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: null });

    const ranked = await service.rankTrucksForWarehouse('wh-1');

    expect(ranked).toEqual([]);
    // Never even asks Odoo — there is no Odoo warehouse to ask about.
    expect(odoo.fetchDeliveryTrucksForWarehouse).not.toHaveBeenCalled();
  });

  it('reads the delivery fleet LIVE from Odoo by the warehouse Odoo id', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: 77 });
    odoo.fetchDeliveryTrucksForWarehouse.mockResolvedValue([
      { id: 91, max_payload_kg: 500 },
      { id: 92, max_payload_kg: 1000 },
    ]);

    const ranked = await service.rankTrucksForWarehouse('wh-1');

    expect(odoo.fetchDeliveryTrucksForWarehouse).toHaveBeenCalledWith(77);
    // Both trucks are candidates; the bigger one ranks first (capacity term).
    expect(ranked.map((r) => r.odooTruckId)).toEqual([92, 91]);
    // No backend truck id leaks — these trucks have no local row.
    expect(ranked[0]).not.toHaveProperty('truckId');
  });

  it('drops a truck that is out on a live trip (busy)', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: 77 });
    odoo.fetchDeliveryTrucksForWarehouse.mockResolvedValue([
      { id: 91, max_payload_kg: 500 },
      { id: 92, max_payload_kg: 1000 },
    ]);
    // Truck 92 is currently ASSIGNED/IN_PROGRESS on a trip.
    tripRepo.find.mockResolvedValue([{ odooTruckId: 92 }]);

    const ranked = await service.rankTrucksForWarehouse('wh-1');

    expect(ranked.map((r) => r.odooTruckId)).toEqual([91]);
  });

  it('pushes a recently-used truck DOWN the ranking (fairness)', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: 77 });
    // Equal capacity, so fairness is the only differentiator.
    odoo.fetchDeliveryTrucksForWarehouse.mockResolvedValue([
      { id: 91, max_payload_kg: 1000 },
      { id: 92, max_payload_kg: 1000 },
    ]);
    // Truck 91 ran 5 trips lately, truck 92 ran none.
    tripRepo.createQueryBuilder.mockReturnValue(
      mkTripQB([{ truck: 91, count: '5' }, { truck: 92, count: '0' }]),
    );

    const ranked = await service.rankTrucksForWarehouse('wh-1');

    // The idle truck wins.
    expect(ranked[0].odooTruckId).toBe(92);
  });

  it('ranks a truck with NO available driver below one that has a driver', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: 77 });
    // The bigger truck (92) would win on capacity, but it has no driver; the
    // smaller truck (91) has one, so it must come first — a truck that cannot
    // run is a last resort, not the pick.
    odoo.fetchDeliveryTrucksForWarehouse.mockResolvedValue([
      { id: 91, max_payload_kg: 500 },
      { id: 92, max_payload_kg: 1000 },
    ]);
    odoo.fetchTrucksWithAvailableDriver.mockResolvedValue([91]); // only 91 has a driver

    const ranked = await service.rankTrucksForWarehouse('wh-1');

    expect(ranked.map((r) => r.odooTruckId)).toEqual([91, 92]);
    expect(ranked[0].hasAvailableDriver).toBe(true);
    expect(ranked[1].hasAvailableDriver).toBe(false);
  });

  it('best-fits the load: the tightest sufficient truck wins, freeing the big one', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: 77 });
    odoo.fetchDeliveryTrucksForWarehouse.mockResolvedValue([
      { id: 91, max_payload_kg: 600 },
      { id: 92, max_payload_kg: 5000 },
    ]);

    // A 500 kg load fits both; the tighter 600 kg truck is the better pick, so
    // the 5000 kg truck stays free for a load that actually needs it.
    const ranked = await service.rankTrucksForWarehouse('wh-1', 500);

    expect(ranked[0].odooTruckId).toBe(91);
    expect(ranked[0].fits).toBe(true);
  });

  it('returns nothing when Odoo lists no delivery trucks for the warehouse', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: 77 });
    odoo.fetchDeliveryTrucksForWarehouse.mockResolvedValue([]);

    await expect(service.rankTrucksForWarehouse('wh-1')).resolves.toEqual([]);
  });

  it('degrades to no-truck (does not throw) when Odoo is unreachable', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: 77 });
    odoo.fetchDeliveryTrucksForWarehouse.mockRejectedValue(new Error('odoo timeout'));

    // A checkout must not fail because Odoo blipped: the trip is planned truckless
    // and assigned later, so the ranking degrades to an empty list here.
    await expect(service.rankTrucksForWarehouse('wh-1')).resolves.toEqual([]);
  });
});
