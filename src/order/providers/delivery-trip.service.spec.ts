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
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn((x: any) => {
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
        minCharge: '0',
        currency: 'SYP',
      }),
    };

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
      orderRepo, partRepo, tripRepo, stopRepo, rates, dataSource,
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

    it('honours a minimum charge without breaking the stop totals', async () => {
      rates.currentOrFail.mockResolvedValue({
        ratePerKm: '1', baseFee: '0', minCharge: '9000', currency: 'SYP',
      });

      await service.planForOrder(ORDER.id);

      expect(Number(savedTrips[0].deliveryCost)).toBe(9000);
      const stopTotal = savedStops.reduce((s, x) => s + Number(x.legCost), 0);
      expect(stopTotal).toBeCloseTo(9000, 3);
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
});
