import { BadRequestException, ConflictException } from '@nestjs/common';
import { DeliveryTripService } from './delivery-trip.service';
import { OrderPartStatus } from '../enums/order-part-status.enum';
import { DeliveryTripStatus } from '../enums/delivery-trip-status.enum';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';

/**
 * The milk run, and the arithmetic underneath it.
 *
 * The thing worth protecting here is the MONEY. A split order sits in three
 * warehouses 40, 25 and 10 km from the buyer, and the tempting way to bill it —
 * each warehouse's own distance, summed — comes to 75 km for a road the truck
 * covers in about 45. That is not a rounding difference; it charges the buyer
 * nearly twice for the same tarmac, on every split order, for ever.
 *
 * So these tests pin the route length to the LEGS the truck actually drives,
 * and pin the per-part costs to summing back to exactly what the buyer pays.
 */
describe('DeliveryTripService', () => {
  let service: DeliveryTripService;
  let orderRepo: any;
  let partRepo: any;
  let tripRepo: any;
  let stopRepo: any;
  let rates: any;
  let dataSource: any;
  let lineRepo: any;
  let productRepo: any;
  let dispatch: any;
  let odoo: any;
  let odooSync: any;
  let distance: any;

  /** Warehouse ids, named by how far they are from the buyer. */
  const FAR = '11111111-1111-1111-1111-111111111111';   // 40 km
  const MID = '22222222-2222-2222-2222-222222222222';   // 25 km
  const NEAR = '33333333-3333-3333-3333-333333333333';  // 10 km

  const ORDER = {
    id: 'order-1',
    orderNumber: 'ORD-1001',
    buyerProfileId: 'buyer-1',
    fulfilmentMode: FulfilmentMode.DELIVERY,
    status: 'PREPARING',
  };

  const part = (id: string, warehouseId: string) => ({
    id,
    orderId: ORDER.id,
    warehouseId,
    status: OrderPartStatus.IN_OUTPUT_ZONE,
  });

  /** Straight-line km between warehouses, before the road factor. */
  const BETWEEN: Record<string, number> = {
    [`${FAR}|${MID}`]: 20,
    [`${MID}|${NEAR}`]: 12,
    [`${FAR}|${NEAR}`]: 30,
  };

  const savedTrips: any[] = [];
  const savedStops: any[] = [];
  const partUpdates: any[] = [];

  beforeEach(() => {
    savedTrips.length = 0;
    savedStops.length = 0;
    partUpdates.length = 0;

    orderRepo = {
      findOne: jest.fn().mockResolvedValue({ ...ORDER }),
      find: jest.fn().mockResolvedValue([{ ...ORDER }]),
      save: jest.fn((x: any) => Promise.resolve(x)),
    };
    partRepo = {
      find: jest.fn().mockResolvedValue([
        part('p-far', FAR),
        part('p-mid', MID),
        part('p-near', NEAR),
      ]),
      findOne: jest.fn(),
      save: jest.fn((x: any) => Promise.resolve(x)),
      update: jest.fn((id: any, vals: any) => {
        partUpdates.push({ id, ...vals });
        return Promise.resolve({ affected: 1 });
      }),
    };

    tripRepo = {
      count: jest.fn().mockResolvedValue(0),
      // The planner re-reads its own trips for the response; return what was
      // built. forOrder/forDriver tests override this per case.
      find: jest.fn(async () => [...savedTrips]),
      findOne: jest.fn(async ({ where }: any) =>
        savedTrips.find((t) => t.id === where.id) ?? null,
      ),
      save: jest.fn((x: any) => {
        if (x.id) {
          const i = savedTrips.findIndex((t) => t.id === x.id);
          if (i >= 0) savedTrips[i] = x;
          else savedTrips.push(x);
          return Promise.resolve(x);
        }
        const row = { id: `trip-${savedTrips.length + 1}`, ...x };
        savedTrips.push(row);
        return Promise.resolve(row);
      }),
      create: jest.fn((x: any) => x),
      query: jest.fn(async (sql: string, params: any[]) => {
        if (sql.includes('distance_cache')) {
          return [
            { warehouse_id: FAR, distance_km: '40' },
            { warehouse_id: MID, distance_km: '25' },
            { warehouse_id: NEAR, distance_km: '10' },
          ].filter((r) => params[1].includes(r.warehouse_id));
        }
        // ST_Distance between two warehouses.
        const key = `${params[0]}|${params[1]}`;
        const reverse = `${params[1]}|${params[0]}`;
        const km = BETWEEN[key] ?? BETWEEN[reverse];
        return km === undefined ? [] : [{ km }];
      }),
    };

    stopRepo = {
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => {
        const row = { id: `stop-${savedStops.length + 1}`, ...x };
        savedStops.push(row);
        return Promise.resolve(row);
      }),
      find: jest.fn(async () => [...savedStops]),
      findOne: jest.fn(),
    };

    rates = {
      currentOrFail: jest.fn().mockResolvedValue({
        ratePerKm: '100',
        baseFee: '500',
        currency: 'SYP',
      }),
    };

    // No fleet configured in these route/cost tests: with no truck the capacity
    // is unbounded, so the whole order rides one trip — which is exactly the
    // single-truck behaviour these tests assert. Weight lookups return nothing,
    // so every part weighs zero and never forces a split.
    lineRepo = { find: jest.fn().mockResolvedValue([]) };
    productRepo = { find: jest.fn().mockResolvedValue([]) };
    dispatch = { rankTrucksForWarehouse: jest.fn().mockResolvedValue([]) };
    // No driver by default → dispatch is a no-op and the trip stays planned,
    // which is what the route/cost tests expect. The dispatch test overrides it.
    odoo = { fetchDeliveryDriverForTruck: jest.fn().mockResolvedValue({}) };
    odooSync = { enqueuePushDeliveryTrip: jest.fn() };
    distance = { rankWarehouses: jest.fn().mockResolvedValue([]) };

    const managerFor = (repos: Record<string, any>) => ({
      getRepository: (entity: any) => repos[entity.name] ?? repos.default,
    });
    dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb(
          managerFor({
            DeliveryTrip: tripRepo,
            DeliveryTripStop: stopRepo,
            OrderPart: partRepo,
            Order: orderRepo,
          }),
        ),
      ),
    };

    service = new DeliveryTripService(
      orderRepo, partRepo, tripRepo, stopRepo, lineRepo, productRepo,
      rates, dispatch, odoo, odooSync, distance, dataSource,
    );
  });

  // ──────────────────────────────────────────────────────────────────
  describe('the route', () => {
    it('starts at the FARTHEST warehouse and works inward', async () => {
      await service.planForOrder(ORDER.id);

      expect(savedStops.map((s) => s.warehouseId)).toEqual([FAR, MID, NEAR]);
      expect(savedStops.map((s) => s.sequence)).toEqual([1, 2, 3]);
    });

    it('the trip belongs to the warehouse it starts from', async () => {
      // A driver and their truck belong to ONE warehouse; a route crossing
      // warehouses has to start where the truck already is, or the first leg
      // is an empty positioning drive nobody is paying for.
      await service.planForOrder(ORDER.id);
      expect(savedTrips[0].originWarehouseId).toBe(FAR);
    });
  });

  describe('the money', () => {
    /**
     * The mistake this whole design exists to avoid.
     *
     * Legs: FAR→MID 20 km, MID→NEAR 12 km, NEAR→buyer 10 km (measured).
     * The two warehouse legs are scaled by the 1.3 road factor:
     *   26 + 15.6 + 10 = 51.6 km
     * Billing each warehouse's own distance instead would give 40+25+10 = 75.
     */
    it('bills the legs the truck drives, not each warehouse to the buyer', async () => {
      await service.planForOrder(ORDER.id);

      expect(Number(savedTrips[0].routeDistanceKm)).toBeCloseTo(51.6, 3);
      expect(Number(savedTrips[0].routeDistanceKm)).not.toBeCloseTo(75, 1);
    });

    it('costs the route at the rate in force, plus the base fee', async () => {
      await service.planForOrder(ORDER.id);
      // 500 + 51.6 × 100
      expect(Number(savedTrips[0].deliveryCost)).toBeCloseTo(5660, 3);
    });

    it('the stops add up to exactly what the buyer pays', async () => {
      // Otherwise a per-warehouse invoice and the buyer's total disagree, and
      // the difference has to be argued about rather than looked up.
      await service.planForOrder(ORDER.id);

      const stopTotal = savedStops.reduce((s, x) => s + Number(x.legCost), 0);
      expect(stopTotal).toBeCloseTo(Number(savedTrips[0].deliveryCost), 3);
    });

    it('charges each part the leg that departs its own warehouse', async () => {
      await service.planForOrder(ORDER.id);

      const byPart = new Map(partUpdates.map((u) => [u.id, Number(u.deliveryCost)]));
      // FAR carries the base fee as well: 500 + 26 × 100
      expect(byPart.get('p-far')).toBeCloseTo(3100, 3);
      expect(byPart.get('p-mid')).toBeCloseTo(1560, 3);
      expect(byPart.get('p-near')).toBeCloseTo(1000, 3);
    });

    it('freezes the rate onto the trip', async () => {
      // The admin can change the rate tomorrow. A buyer asking why they paid
      // what they paid must get an answer that does not change afterwards.
      await service.planForOrder(ORDER.id);
      expect(Number(savedTrips[0].ratePerKm)).toBe(100);
      expect(Number(savedTrips[0].baseFee)).toBe(500);
    });

    it('sums the stop leg costs to the trip cost, base fee on the first stop', async () => {
      rates.currentOrFail.mockResolvedValue({
        ratePerKm: '1', baseFee: '300', currency: 'SYP',
      });

      await service.planForOrder(ORDER.id);

      const stopTotal = savedStops.reduce((s, x) => s + Number(x.legCost), 0);
      expect(stopTotal).toBeCloseTo(Number(savedTrips[0].deliveryCost), 3);
    });
  });

  describe('more than one truck', () => {
    it('costs each truck its own route', async () => {
      await service.planForOrder(ORDER.id, [['p-far'], ['p-mid', 'p-near']]);

      expect(savedTrips).toHaveLength(2);
      // Truck 1: FAR→buyer only, 40 km measured.
      expect(Number(savedTrips[0].routeDistanceKm)).toBeCloseTo(40, 3);
      // Truck 2: MID→NEAR (12 × 1.3) + NEAR→buyer 10.
      expect(Number(savedTrips[1].routeDistanceKm)).toBeCloseTo(25.6, 3);
    });

    it('gives each truck its own trip number', async () => {
      await service.planForOrder(ORDER.id, [['p-far'], ['p-mid', 'p-near']]);
      expect(savedTrips.map((t) => t.tripNumber)).toEqual([
        'TRIP-ORD-1001-1', 'TRIP-ORD-1001-2',
      ]);
    });

    it('refuses a part put on two trucks', async () => {
      // Two trucks each believing they carry it is how a part is delivered
      // twice on paper and never in fact.
      await expect(
        service.planForOrder(ORDER.id, [['p-far', 'p-mid'], ['p-mid', 'p-near']]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a part left off every truck', async () => {
      await expect(
        service.planForOrder(ORDER.id, [['p-far'], ['p-mid']]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('what may be planned', () => {
    it('refuses a collection order', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...ORDER, fulfilmentMode: FulfilmentMode.PICKUP,
      });
      await expect(service.planForOrder(ORDER.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses while a live trip already exists', async () => {
      tripRepo.count.mockResolvedValue(1);
      await expect(service.planForOrder(ORDER.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('only routes parts that are prepared and waiting', async () => {
      // A part still being picked has nothing on the loading bay, and routing
      // a truck to it sends the driver to wait — which turns the milk run back
      // into separate journeys.
      partRepo.find.mockResolvedValue([
        { ...part('p-far', FAR), status: OrderPartStatus.PROCESSING },
        part('p-near', NEAR),
      ]);

      await service.planForOrder(ORDER.id);

      expect(savedStops.map((s) => s.warehouseId)).toEqual([NEAR]);
    });

    it('refuses when nothing is ready yet', async () => {
      partRepo.find.mockResolvedValue([
        { ...part('p-far', FAR), status: OrderPartStatus.PROCESSING },
      ]);
      await expect(service.planForOrder(ORDER.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('custody', () => {
    const trip = {
      id: 'trip-1',
      orderId: ORDER.id,
      status: DeliveryTripStatus.ASSIGNED,
    };

    beforeEach(() => {
      tripRepo.findOne.mockResolvedValue({ ...trip });
      stopRepo.find.mockResolvedValue([
        { id: 's1', tripId: 'trip-1', partId: 'p-far', sequence: 1, pickedUpAt: null },
        { id: 's2', tripId: 'trip-1', partId: 'p-mid', sequence: 2, pickedUpAt: null },
      ]);
      partRepo.findOne.mockResolvedValue(part('p-far', FAR));
    });

    it('a pickup hands the part to the driver and starts the trip', async () => {
      const res = await service.confirmPickup('trip-1', 's1');

      expect(res.remaining_stops).toBe(1);
      const savedPart = partRepo.save.mock.calls[0][0];
      expect(savedPart.status).toBe(OrderPartStatus.DISPATCHED);
      expect(savedPart.dispatchedAt).toBeInstanceOf(Date);
    });

    it('refuses stops taken out of order', async () => {
      // The route exists so the truck does not double back. A driver reporting
      // stop 2 before stop 1 means the route was abandoned or the wrong button
      // was pressed — both worth refusing rather than recording.
      await expect(
        service.confirmPickup('trip-1', 's2'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a second confirmation of the same stop', async () => {
      stopRepo.find.mockResolvedValue([
        { id: 's1', tripId: 'trip-1', partId: 'p-far', sequence: 1, pickedUpAt: new Date() },
      ]);
      await expect(
        service.confirmPickup('trip-1', 's1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to complete a trip with goods still uncollected', async () => {
      // Closing at the buyer with two of three parts would leave the third in
      // a warehouse, with the trip meant to fetch it already finished.
      tripRepo.findOne.mockResolvedValue({
        ...trip, status: DeliveryTripStatus.IN_PROGRESS,
      });
      await expect(
        service.completeTrip('trip-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('completing marks the parts delivered and the order ready for the buyer', async () => {
      tripRepo.findOne.mockResolvedValue({
        ...trip, status: DeliveryTripStatus.IN_PROGRESS,
      });
      const collected = [
        { id: 's1', tripId: 'trip-1', partId: 'p-far', sequence: 1, pickedUpAt: new Date() },
        { id: 's2', tripId: 'trip-1', partId: 'p-mid', sequence: 2, pickedUpAt: new Date() },
      ];
      stopRepo.find.mockResolvedValue(collected);
      partRepo.findOne.mockImplementation(async ({ where }: any) => ({
        ...part(where.id, FAR),
        status: OrderPartStatus.DISPATCHED,
      }));
      partRepo.find.mockResolvedValue([
        { ...part('p-far', FAR), status: OrderPartStatus.DELIVERED },
        { ...part('p-mid', MID), status: OrderPartStatus.DELIVERED },
      ]);

      const res = await service.completeTrip('trip-1');

      expect(res.order_ready_for_buyer_confirmation).toBe(true);

      // The order reaches DELIVERED — and stops there. COMPLETED is the
      // BUYER's word, given through confirm-receipt: two signatures on one
      // handover is what protects both sides of it.
      const savedOrder = orderRepo.save.mock.calls[0][0];
      expect(savedOrder.status).toBe('DELIVERED');
      expect(savedOrder.status).not.toBe('COMPLETED');
    });

    it('leaves the order alone while a second truck is still out', async () => {
      tripRepo.findOne.mockResolvedValue({
        ...trip, status: DeliveryTripStatus.IN_PROGRESS,
      });
      stopRepo.find.mockResolvedValue([
        { id: 's1', tripId: 'trip-1', partId: 'p-far', sequence: 1, pickedUpAt: new Date() },
      ]);
      partRepo.findOne.mockResolvedValue({
        ...part('p-far', FAR), status: OrderPartStatus.DISPATCHED,
      });
      partRepo.find.mockResolvedValue([
        { ...part('p-far', FAR), status: OrderPartStatus.DELIVERED },
        { ...part('p-mid', MID), status: OrderPartStatus.DISPATCHED },
      ]);

      const res = await service.completeTrip('trip-1');

      expect(res.order_ready_for_buyer_confirmation).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  describe('automatic planning (weight, capacity, truck choice)', () => {
    const kgLine = (partId: string, quantity: number) => ({
      partId,
      productId: `prod-${partId}`,
      quantity: String(quantity),
      unitType: 'KG',
    });

    it('splits by weight and assigns each trip its start warehouse’s truck', () => {
      // Weights: far 400, mid 300, near 150 kg.
      lineRepo.find.mockResolvedValue([
        kgLine('p-far', 400),
        kgLine('p-mid', 300),
        kgLine('p-near', 150),
      ]);
      // Far has a 500 kg truck; Mid has a 1000 kg truck; Near has none.
      dispatch.rankTrucksForWarehouse.mockImplementation(async (wh: string) => {
        if (wh === FAR) return [{ truckId: 't-far', odooTruckId: 91, maxPayloadKg: 500, recentTripCount: 0, score: 1 }];
        if (wh === MID) return [{ truckId: 't-mid', odooTruckId: 92, maxPayloadKg: 1000, recentTripCount: 0, score: 1 }];
        return [];
      });

      return service.planForOrder(ORDER.id).then(() => {
        // Far (400) alone fills its 500 kg truck; mid+near ride mid's truck.
        expect(savedTrips).toHaveLength(2);
        expect(savedTrips[0].odooTruckId).toBe(91);
        expect(savedTrips[1].odooTruckId).toBe(92);

        const t1 = savedStops.filter((s) => s.tripId === 'trip-1').map((s) => s.warehouseId);
        const t2 = savedStops.filter((s) => s.tripId === 'trip-2').map((s) => s.warehouseId);
        expect(t1).toEqual([FAR]);
        expect(t2).toEqual([MID, NEAR]);
      });
    });

    it('keeps the whole order on one truck when it all fits', async () => {
      lineRepo.find.mockResolvedValue([
        kgLine('p-far', 100),
        kgLine('p-mid', 100),
        kgLine('p-near', 100),
      ]);
      dispatch.rankTrucksForWarehouse.mockResolvedValue([
        { truckId: 't1', odooTruckId: 70, maxPayloadKg: 5000, recentTripCount: 0, score: 1 },
      ]);

      await service.planForOrder(ORDER.id);

      expect(savedTrips).toHaveLength(1);
      expect(savedTrips[0].odooTruckId).toBe(70);
      expect(savedStops.map((s) => s.warehouseId)).toEqual([FAR, MID, NEAR]);
    });
  });

  describe('dispatch (resolve driver, assign, push)', () => {
    beforeEach(() => {
      lineRepo.find.mockResolvedValue([]);
      dispatch.rankTrucksForWarehouse.mockResolvedValue([
        { truckId: 't1', odooTruckId: 88, maxPayloadKg: 5000, recentTripCount: 0, score: 1 },
      ]);
    });

    it('resolves the driver, marks the trip ASSIGNED, and queues the push', async () => {
      odoo.fetchDeliveryDriverForTruck.mockResolvedValue({
        driver_id: 42, name: 'Rami', phone: '0791234567',
      });

      await service.planForOrder(ORDER.id);

      // The chosen truck's driver was looked up in Odoo.
      expect(odoo.fetchDeliveryDriverForTruck).toHaveBeenCalledWith(88);
      const trip = savedTrips.find((t) => t.odooTruckId === 88);
      expect(trip.status).toBe('ASSIGNED');
      expect(trip.odooDriverId).toBe(42);
      expect(trip.driverName).toBe('Rami');
      // And the trip was queued to appear on the driver's dashboard.
      expect(odooSync.enqueuePushDeliveryTrip).toHaveBeenCalledTimes(1);
      const pushed = odooSync.enqueuePushDeliveryTrip.mock.calls[0][0].trip;
      expect(pushed.truck_odoo_id).toBe(88);
      expect(pushed.driver_odoo_id).toBe(42);
      expect(pushed.status).toBe('assigned');
      expect(pushed.stops.length).toBeGreaterThan(0);
    });

    it('leaves the trip PLANNED and does NOT push when the truck has no driver', async () => {
      odoo.fetchDeliveryDriverForTruck.mockResolvedValue({});

      await service.planForOrder(ORDER.id);

      const trip = savedTrips.find((t) => t.odooTruckId === 88);
      expect(trip.status).toBe('PLANNED');
      expect(odooSync.enqueuePushDeliveryTrip).not.toHaveBeenCalled();
    });
  });

  describe('delivery estimate (best / worst, pre-order)', () => {
    it('prices best (nearest, one truck) and worst (max split)', async () => {
      distance.rankWarehouses.mockResolvedValue([
        { warehouseId: 'a', distanceKm: 10 },
        { warehouseId: 'b', distanceKm: 25 },
        { warehouseId: 'c', distanceKm: 40 },
        { warehouseId: 'd', distanceKm: 55 },
      ]);

      const res: any = await service.estimateDelivery('buyer-1', 'prov-1');

      expect(res.available).toBe(true);
      // rate: base 500 + 100/km. Best = one truck at 10 km.
      expect(res.best_case.trucks).toBe(1);
      expect(res.best_case.cost).toBe(1500);
      // Worst = split across EVERY candidate warehouse (no cap), each its own
      // truck: (500+1000)+(500+2500)+(500+4000)+(500+5500) = 15000.
      expect(res.worst_case.trucks).toBe(4);
      expect(res.worst_case.cost).toBe(15000);
    });

    it('reports unavailable when no warehouse serves the buyer', async () => {
      distance.rankWarehouses.mockResolvedValue([]);
      const res: any = await service.estimateDelivery('buyer-1', 'prov-1');
      expect(res.available).toBe(false);
    });
  });

  describe('driver next-stop view', () => {
    it('shows the driver ONLY the next uncollected station', async () => {
      const trip = {
        id: 'trip-9', tripNumber: 'TRIP-1', orderId: ORDER.id,
        originWarehouseId: FAR, status: 'IN_PROGRESS', odooDriverId: 55,
        routeDistanceKm: '50', deliveryCost: '600', currency: 'SYP',
        stops: [
          { id: 's1', sequence: 1, partId: 'p-far', warehouseId: FAR, distanceToBuyerKm: '40', legDistanceKm: '20', legCost: '2500', pickedUpAt: new Date() },
          { id: 's2', sequence: 2, partId: 'p-mid', warehouseId: MID, distanceToBuyerKm: '25', legDistanceKm: '12', legCost: '1200', pickedUpAt: null },
          { id: 's3', sequence: 3, partId: 'p-near', warehouseId: NEAR, distanceToBuyerKm: '10', legDistanceKm: '10', legCost: '1000', pickedUpAt: null },
        ],
      };
      tripRepo.find.mockResolvedValue([trip]);

      const res: any = await service.forDriver(55);

      expect(res.trips).toHaveLength(1);
      // Only the next station (s2) is exposed — not the whole route.
      expect(res.trips[0].stops).toHaveLength(1);
      expect(res.trips[0].stops[0].stop_id).toBe('s2');
      expect(res.trips[0].next_stop.stop_id).toBe('s2');
      expect(res.trips[0].remaining_stops).toBe(2);
      // Each point carries a maps link field (null coords here → null url).
      expect(res.trips[0].stops[0].location).toHaveProperty('maps_url');
      expect(res.trips[0]).toHaveProperty('destination');
    });
  });

  describe('admin delivery-stages view', () => {
    it('shows every station with its status and pickup time', async () => {
      const trip = {
        id: 'trip-10', tripNumber: 'TRIP-1', orderId: ORDER.id,
        originWarehouseId: FAR, status: 'IN_PROGRESS',
        routeDistanceKm: '50', deliveryCost: '600', currency: 'SYP',
        stops: [
          { id: 's1', sequence: 1, partId: 'p-far', warehouseId: FAR, distanceToBuyerKm: '40', legDistanceKm: '20', legCost: '2500', pickedUpAt: new Date() },
          { id: 's2', sequence: 2, partId: 'p-mid', warehouseId: MID, distanceToBuyerKm: '25', legDistanceKm: '12', legCost: '1200', pickedUpAt: null },
        ],
      };
      tripRepo.find.mockResolvedValue([trip]);

      const res: any = await service.forOrder(ORDER.id);

      expect(res.trips[0].stops).toHaveLength(2);
      expect(res.trips[0].stops[0].status).toBe('PICKED_UP');
      expect(res.trips[0].stops[1].status).toBe('CURRENT');
      expect(res.trips[0].stops[0].location).toHaveProperty('maps_url');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Consolidation: gather a split PICKUP order into the nearest warehouse.
  // ──────────────────────────────────────────────────────────────────
  describe('consolidation', () => {
    const CONSOLIDATE_ORDER = {
      ...ORDER,
      fulfilmentMode: FulfilmentMode.PICKUP,
      consolidate: true,
      status: 'PREPARING',
    };

    beforeEach(() => {
      orderRepo.findOne.mockResolvedValue({ ...CONSOLIDATE_ORDER });
    });

    it('gathers into the NEAREST warehouse; the far parts are the stops, farthest first', async () => {
      const res: any = await service.planConsolidationForOrder(ORDER.id);

      // NEAR (10 km to buyer) is the gathering point — never a stop.
      expect(res.consolidation_warehouse_id).toBe(NEAR);
      expect(savedStops.map((s) => s.warehouseId)).toEqual([FAR, MID]);
      expect(savedTrips[0].isConsolidation).toBe(true);
      expect(savedTrips[0].destinationWarehouseId).toBe(NEAR);
    });

    it('bills the inter-warehouse route only — no leg to the buyer', async () => {
      await service.planConsolidationForOrder(ORDER.id);

      // Route: FAR→MID (20×1.3=26) + MID→NEAR (12×1.3=15.6) = 41.6 km.
      expect(Number(savedTrips[0].routeDistanceKm)).toBeCloseTo(41.6, 3);
      // Cost: base 500 + 100 × 41.6 = 4660.
      expect(Number(savedTrips[0].deliveryCost)).toBeCloseTo(4660, 3);
    });

    it('moves the order to CONSOLIDATING', async () => {
      await service.planConsolidationForOrder(ORDER.id);
      const consolidating = savedTrips.length > 0; // a trip was planned
      expect(consolidating).toBe(true);
      // The order was saved as CONSOLIDATING inside the transaction.
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CONSOLIDATING' }),
      );
    });

    it('refuses to gather until every warehouse has prepared', async () => {
      partRepo.find.mockResolvedValue([
        part('p-far', FAR),
        { ...part('p-mid', MID), status: OrderPartStatus.PROCESSING }, // not ready
        part('p-near', NEAR),
      ]);
      await expect(service.planConsolidationForOrder(ORDER.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses consolidation on a delivery order', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...CONSOLIDATE_ORDER,
        fulfilmentMode: FulfilmentMode.DELIVERY,
      });
      await expect(service.planConsolidationForOrder(ORDER.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('completes: gathered parts and the nearest part become READY_FOR_PICKUP, order too', async () => {
      // A consolidation trip with both far stops already collected.
      const trip = {
        id: 'ctrip-1',
        orderId: ORDER.id,
        isConsolidation: true,
        destinationWarehouseId: NEAR,
        status: DeliveryTripStatus.IN_PROGRESS,
      };
      savedTrips.push(trip);
      savedStops.push(
        { id: 's1', tripId: 'ctrip-1', partId: 'p-far', warehouseId: FAR, sequence: 1, pickedUpAt: new Date() },
        { id: 's2', tripId: 'ctrip-1', partId: 'p-mid', warehouseId: MID, sequence: 2, pickedUpAt: new Date() },
      );
      const parts: any = {
        'p-far': { id: 'p-far', orderId: ORDER.id, warehouseId: FAR, status: OrderPartStatus.DISPATCHED },
        'p-mid': { id: 'p-mid', orderId: ORDER.id, warehouseId: MID, status: OrderPartStatus.DISPATCHED },
        'p-near': { id: 'p-near', orderId: ORDER.id, warehouseId: NEAR, status: OrderPartStatus.IN_OUTPUT_ZONE },
      };
      partRepo.findOne.mockImplementation(async ({ where }: any) => parts[where.id] ?? null);
      partRepo.find.mockResolvedValue(Object.values(parts));
      partRepo.save.mockImplementation((p: any) => { parts[p.id] = p; return Promise.resolve(p); });
      orderRepo.findOne.mockResolvedValue({
        ...CONSOLIDATE_ORDER,
        status: 'CONSOLIDATING',
        consolidationWarehouseId: NEAR,
      });

      const res: any = await service.completeTrip('ctrip-1');

      expect(res.order_ready_for_pickup).toBe(true);
      expect(parts['p-far'].status).toBe(OrderPartStatus.READY_FOR_PICKUP);
      expect(parts['p-near'].status).toBe(OrderPartStatus.READY_FOR_PICKUP);
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'READY_FOR_PICKUP' }),
      );
    });

    it('eligibility: a split non-delivery order can consolidate, into the nearest warehouse', async () => {
      orderRepo.findOne.mockResolvedValue({ ...CONSOLIDATE_ORDER, consolidate: false, status: 'AWAITING_APPROVAL' });
      const order = await orderRepo.findOne({ where: { id: ORDER.id } });

      const elig: any = await service.consolidationEligibility(order);

      expect(elig.available).toBe(true);
      expect(elig.consolidation_warehouse_id).toBe(NEAR);
      // Estimate = base 500 + 100 × 41.6 = 4660 (single-truck milk run).
      expect(elig.estimated_cost).toBeCloseTo(4660, 3);
    });

    it('eligibility: a delivery order is never offered consolidation', async () => {
      const order = { ...CONSOLIDATE_ORDER, fulfilmentMode: FulfilmentMode.DELIVERY };
      const elig: any = await service.consolidationEligibility(order as any);
      expect(elig.available).toBe(false);
    });
  });
});
