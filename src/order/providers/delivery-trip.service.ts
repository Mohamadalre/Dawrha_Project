import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderPart } from '../entities/order-part.entity';
import { DeliveryTrip } from '../entities/delivery-trip.entity';
import { DeliveryTripStop } from '../entities/delivery-trip-stop.entity';
import {
  DeliveryTripStatus,
  canTransitionTrip,
} from '../enums/delivery-trip-status.enum';
import {
  FAILED_PART_STATUSES,
  OrderPartStatus,
  canTransitionPart,
} from '../enums/order-part-status.enum';
import { OrderStatus } from '../enums/order-status.enum';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import { DeliveryRateService } from '@src/warehouse/providers/delivery-rate.service';

/**
 * Roads are not straight. A great-circle distance between two yards understates
 * the drive, and understating it is the direction that costs the company money
 * on every trip rather than the buyer.
 *
 * 1.3 is the usual planning figure for road networks. It is only ever used for
 * warehouse-to-warehouse legs and only when a measured distance is unavailable
 * — the warehouse-to-BUYER distance always comes from the measured cache.
 */
const ROAD_WINDING_FACTOR = 1.3;

/** A part that is ready to be carried, with where it is and how far that is. */
interface Collectable {
  part: OrderPart;
  warehouseId: string;
  distanceToBuyerKm: number;
}

/**
 * Planning and running the delivery of a SPLIT order.
 *
 * The problem this exists for: a buyer order that no single warehouse could
 * fill ends up in three of them, and all three have to reach the buyer. The
 * obvious answer — a van from each — bills three journeys down largely the same
 * road and occupies three drivers for one delivery.
 *
 * So a trip is a milk run. The truck starts at the warehouse FARTHEST from the
 * buyer, calls at the nearer ones on the way in, and arrives loaded. The route
 * is ordered by descending distance-to-buyer, which is cheap, deterministic and
 * explainable — and, on the geography this serves (warehouses spread around a
 * governorate, buyer inside it), close to optimal.
 *
 * WHERE THIS IS A HEURISTIC, SAY SO: descending distance-to-buyer is not a
 * solved travelling-salesman route. A warehouse that is 25 km from the buyer
 * but in the opposite direction from the 40 km one will produce a longer drive
 * than a real solver would. The cost the buyer pays is computed from the ACTUAL
 * leg distances of the route chosen, never from an idealised one, so a
 * suboptimal route is visibly suboptimal rather than quietly mispriced — and a
 * better ordering can replace `orderStops` alone, without touching costing,
 * custody or anything else here.
 */
@Injectable()
export class DeliveryTripService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderPart)
    private readonly partRepo: Repository<OrderPart>,
    @InjectRepository(DeliveryTrip)
    private readonly tripRepo: Repository<DeliveryTrip>,
    @InjectRepository(DeliveryTripStop)
    private readonly stopRepo: Repository<DeliveryTripStop>,
    private readonly rates: DeliveryRateService,
    private readonly dataSource: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Planning
  // ────────────────────────────────────────────────────────────────────
  /**
   * Build the trip (or trips) that will carry this order to the buyer.
   *
   * `truckGroups` lets a dispatcher say which parts go on which truck — one
   * inner array per vehicle. Omitted, everything goes on one truck.
   *
   * The system deliberately does NOT decide that for itself. Splitting by
   * capacity means comparing a load against a payload in kilograms, and this
   * catalogue measures some materials in kilograms and others in pieces. There
   * is no honest conversion between them, so a system that guessed would
   * sometimes send one truck for a load it cannot carry — and the failure would
   * appear at the warehouse gate, with the goods already picked.
   */
  async planForOrder(orderId: string, truckGroups?: string[][]) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    if (order.fulfilmentMode !== FulfilmentMode.DELIVERY) {
      throw new BadRequestException(
        'This order is a collection — the buyer comes to the warehouse, so there is nothing to route',
      );
    }

    const existing = await this.tripRepo.count({
      where: {
        orderId,
        status: In([
          DeliveryTripStatus.PLANNED,
          DeliveryTripStatus.ASSIGNED,
          DeliveryTripStatus.IN_PROGRESS,
        ]),
      },
    });
    if (existing) {
      throw new ConflictException(
        'This order already has a live delivery trip. Cancel it before planning another.',
      );
    }

    const collectables = await this.collectablesFor(order);
    if (!collectables.length) {
      throw new BadRequestException(
        'No part of this order is prepared and waiting to be collected',
      );
    }

    const groups = this.resolveGroups(collectables, truckGroups);
    const rate = await this.rates.currentOrFail();

    const trips: DeliveryTrip[] = [];
    await this.dataSource.transaction(async (manager) => {
      let index = 0;
      for (const group of groups) {
        index += 1;
        trips.push(
          await this.buildTrip(manager, order, group, rate, index, groups.length),
        );
      }
    });

    return {
      message: 'Delivery planned',
      order_id: orderId,
      trip_count: trips.length,
      trips: trips.map((t) => this.tripView(t)),
    };
  }

  /**
   * The parts that are physically ready to be picked up.
   *
   * IN_OUTPUT_ZONE and nothing else. A part still being prepared has nothing on
   * the loading bay, and routing a truck to it would send the driver to wait —
   * which is how a milk run turns into three separate journeys anyway.
   */
  private async collectablesFor(order: Order): Promise<Collectable[]> {
    const parts = await this.partRepo.find({ where: { orderId: order.id } });
    const live = parts.filter(
      (p) =>
        !FAILED_PART_STATUSES.includes(p.status) &&
        p.status === OrderPartStatus.IN_OUTPUT_ZONE,
    );
    if (!live.length) return [];

    const distances = await this.distancesToBuyer(
      order.buyerProfileId,
      live.map((p) => p.warehouseId),
    );

    return live.map((part) => ({
      part,
      warehouseId: part.warehouseId,
      distanceToBuyerKm: distances.get(part.warehouseId) ?? 0,
    }));
  }

  /** Measured warehouse→buyer distances, from the cache the allocator fills. */
  private async distancesToBuyer(
    buyerProfileId: string,
    warehouseIds: string[],
  ): Promise<Map<string, number>> {
    if (!warehouseIds.length) return new Map();
    const rows = await this.tripRepo.query(
      `SELECT warehouse_id, distance_km
         FROM distance_cache
        WHERE buyer_profile_id = $1 AND warehouse_id = ANY($2::uuid[])`,
      [buyerProfileId, warehouseIds],
    );
    return new Map(
      rows.map((r: any) => [r.warehouse_id, Number(r.distance_km)]),
    );
  }

  /** One group per truck; the dispatcher's grouping if they gave one. */
  private resolveGroups(
    collectables: Collectable[],
    truckGroups?: string[][],
  ): Collectable[][] {
    if (!truckGroups?.length) return [collectables];

    const byPartId = new Map(collectables.map((c) => [c.part.id, c]));
    const seen = new Set<string>();
    const groups: Collectable[][] = [];

    for (const group of truckGroups) {
      const resolved: Collectable[] = [];
      for (const partId of group) {
        const found = byPartId.get(partId);
        if (!found) {
          throw new BadRequestException(
            `Part ${partId} is not ready to be collected on this order`,
          );
        }
        if (seen.has(partId)) {
          // Two trucks each believing they carry it is how a part is delivered
          // twice on paper and never in fact.
          throw new BadRequestException(
            `Part ${partId} was assigned to more than one truck`,
          );
        }
        seen.add(partId);
        resolved.push(found);
      }
      if (resolved.length) groups.push(resolved);
    }

    const missed = collectables.filter((c) => !seen.has(c.part.id));
    if (missed.length) {
      throw new BadRequestException(
        `These parts were left off every truck: ${missed
          .map((c) => c.part.id)
          .join(', ')}`,
      );
    }
    return groups;
  }

  /**
   * Farthest from the buyer first.
   *
   * The truck accumulates load as it moves inward and finishes at the buyer, so
   * it never doubles back — and the heaviest leg is driven while the vehicle is
   * emptiest.
   */
  private orderStops(group: Collectable[]): Collectable[] {
    return [...group].sort(
      (a, b) => b.distanceToBuyerKm - a.distanceToBuyerKm,
    );
  }

  private async buildTrip(
    manager: any,
    order: Order,
    group: Collectable[],
    rate: { ratePerKm: string; baseFee: string; minCharge: string; currency: string },
    index: number,
    total: number,
  ): Promise<DeliveryTrip> {
    const stops = this.orderStops(group);
    const legs = await this.legDistances(stops, order.buyerProfileId);

    const ratePerKm = Number(rate.ratePerKm);
    const baseFee = Number(rate.baseFee);
    const minCharge = Number(rate.minCharge);

    const routeDistanceKm = round3(legs.reduce((sum, km) => sum + km, 0));
    // Base fee sits on the FIRST stop — the leg that begins the journey — so
    // the stops' costs still add up to the trip's cost exactly.
    const rawCost = baseFee + ratePerKm * routeDistanceKm;
    const deliveryCost = round3(Math.max(rawCost, minCharge));

    const tripRepo = manager.getRepository(DeliveryTrip);
    const stopRepo = manager.getRepository(DeliveryTripStop);
    const partRepo = manager.getRepository(OrderPart);

    const trip = await tripRepo.save(
      tripRepo.create({
        orderId: order.id,
        tripNumber: this.tripNumber(order, index, total),
        originWarehouseId: stops[0].warehouseId,
        status: DeliveryTripStatus.PLANNED,
        routeDistanceKm: String(routeDistanceKm),
        deliveryCost: String(deliveryCost),
        ratePerKm: String(ratePerKm),
        baseFee: String(baseFee),
        currency: rate.currency,
      }),
    );

    // Any shortfall between the raw cost and a minimum charge lands on the
    // first stop too, so the parts never sum to less than the buyer pays.
    const minTopUp = round3(Math.max(deliveryCost - rawCost, 0));

    for (let i = 0; i < stops.length; i += 1) {
      const legKm = round3(legs[i]);
      const legCost = round3(
        legKm * ratePerKm + (i === 0 ? baseFee + minTopUp : 0),
      );

      await stopRepo.save(
        stopRepo.create({
          tripId: trip.id,
          partId: stops[i].part.id,
          warehouseId: stops[i].warehouseId,
          sequence: i + 1,
          distanceToBuyerKm: String(round3(stops[i].distanceToBuyerKm)),
          legDistanceKm: String(legKm),
          legCost: String(legCost),
        }),
      );

      // The part carries what its own warehouse's leg cost, so an invoice per
      // warehouse still reconciles to the trip.
      await partRepo.update(stops[i].part.id, {
        deliveryCost: String(legCost),
        distanceKm: String(round3(stops[i].distanceToBuyerKm)),
      });
    }

    trip.stops = await stopRepo.find({
      where: { tripId: trip.id },
      order: { sequence: 'ASC' },
    });
    return trip;
  }

  /**
   * Leg lengths along the route: stop→stop, and the last stop→buyer.
   *
   * The final leg is a MEASURED distance (the cache the allocator fills). The
   * intermediate warehouse-to-warehouse legs are great-circle distances scaled
   * by a road factor: they are between company sites, they are not what the
   * buyer is quoted on individually, and measuring each pair would mean a paid
   * routing call per leg per trip for a number that moves the total by a few
   * per cent.
   */
  private async legDistances(
    stops: Collectable[],
    buyerProfileId: string,
  ): Promise<number[]> {
    const legs: number[] = [];

    for (let i = 0; i < stops.length - 1; i += 1) {
      legs.push(
        await this.betweenWarehouses(
          stops[i].warehouseId,
          stops[i + 1].warehouseId,
        ),
      );
    }
    // The run in: measured, because this is the leg the buyer sees.
    legs.push(round3(stops[stops.length - 1].distanceToBuyerKm));
    return legs;
  }

  private async betweenWarehouses(fromId: string, toId: string): Promise<number> {
    if (fromId === toId) return 0;
    const rows = await this.tripRepo.query(
      `
      SELECT ST_Distance(
               ST_SetSRID(ST_MakePoint(a.longitude::float8, a.latitude::float8), 4326)::geography,
               ST_SetSRID(ST_MakePoint(b.longitude::float8, b.latitude::float8), 4326)::geography
             ) / 1000.0 AS km
        FROM warehouses a, warehouses b
       WHERE a.id = $1 AND b.id = $2
         AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL
         AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL
      `,
      [fromId, toId],
    );
    if (!rows.length) return 0;
    return round3(Number(rows[0].km) * ROAD_WINDING_FACTOR);
  }

  private tripNumber(order: Order, index: number, total: number): string {
    const base = `TRIP-${order.orderNumber}`;
    return total > 1 ? `${base}-${index}` : base;
  }

  // ────────────────────────────────────────────────────────────────────
  // Running
  // ────────────────────────────────────────────────────────────────────
  /** Put a truck and driver on a planned trip. */
  async assign(
    tripId: string,
    input: {
      odooTruckId: number;
      odooDriverId: number;
      driverName?: string;
      driverPhone?: string;
    },
  ) {
    const trip = await this.tripOrThrow(tripId);
    this.assertTransition(trip, DeliveryTripStatus.ASSIGNED);

    trip.odooTruckId = input.odooTruckId;
    trip.odooDriverId = input.odooDriverId;
    trip.driverName = input.driverName;
    trip.driverPhone = input.driverPhone;
    trip.status = DeliveryTripStatus.ASSIGNED;
    await this.tripRepo.save(trip);

    return { message: 'Truck assigned', trip: this.tripView(trip) };
  }

  /**
   * The driver confirms taking one warehouse's goods.
   *
   * This is where custody actually changes hands, so it is the driver's action
   * and nobody else's — and it is what moves the part to DISPATCHED. A stop
   * cannot be collected out of order: the route exists so the truck does not
   * double back, and a driver reporting stop 3 before stop 1 means either the
   * route was abandoned or the wrong button was pressed. Both are worth
   * refusing rather than recording.
   */
  async confirmPickup(tripId: string, stopId: string, note?: string) {
    return this.dataSource.transaction(async (manager) => {
      const tripRepo = manager.getRepository(DeliveryTrip);
      const stopRepo = manager.getRepository(DeliveryTripStop);
      const partRepo = manager.getRepository(OrderPart);

      const trip = await tripRepo.findOne({ where: { id: tripId } });
      if (!trip) throw new NotFoundException('Trip not found');
      if (
        trip.status !== DeliveryTripStatus.ASSIGNED &&
        trip.status !== DeliveryTripStatus.IN_PROGRESS
      ) {
        throw new ConflictException(
          `A pickup cannot be recorded on a ${trip.status} trip`,
        );
      }

      const stops = await stopRepo.find({
        where: { tripId },
        order: { sequence: 'ASC' },
      });
      const stop = stops.find((s) => s.id === stopId);
      if (!stop) throw new NotFoundException('Stop not found on this trip');
      if (stop.pickedUpAt) {
        throw new ConflictException('This stop was already collected');
      }

      const earlier = stops.filter(
        (s) => s.sequence < stop.sequence && !s.pickedUpAt,
      );
      if (earlier.length) {
        throw new ConflictException(
          `Stop ${stop.sequence} cannot be collected before stop ${earlier[0].sequence} — the route runs farthest warehouse first`,
        );
      }

      stop.pickedUpAt = new Date();
      stop.pickedUpNote = note;
      await stopRepo.save(stop);

      const part = await partRepo.findOne({ where: { id: stop.partId } });
      if (part) {
        if (!canTransitionPart(part.status, OrderPartStatus.DISPATCHED)) {
          throw new ConflictException(
            `Part ${part.id} is ${part.status} and cannot be handed to a driver`,
          );
        }
        part.status = OrderPartStatus.DISPATCHED;
        part.dispatchedAt = new Date();
        await partRepo.save(part);
      }

      if (trip.status === DeliveryTripStatus.ASSIGNED) {
        trip.status = DeliveryTripStatus.IN_PROGRESS;
        trip.startedAt = new Date();
        await tripRepo.save(trip);
      }

      const outstanding = stops.filter(
        (s) => s.id !== stop.id && !s.pickedUpAt,
      ).length;

      return {
        message: 'Pickup confirmed',
        stop_id: stop.id,
        sequence: stop.sequence,
        remaining_stops: outstanding,
      };
    });
  }

  /**
   * The driver hands the whole load to the buyer.
   *
   * Refused while any stop is outstanding: arriving at the buyer with two of
   * three parts and closing the trip would leave the third sitting in a
   * warehouse with the trip that was meant to fetch it already finished.
   *
   * This marks the parts DELIVERED. It does NOT complete the order — the buyer
   * confirms receipt themselves, which is the whole point of having two
   * signatures on the same handover.
   */
  async completeTrip(tripId: string) {
    return this.dataSource.transaction(async (manager) => {
      const tripRepo = manager.getRepository(DeliveryTrip);
      const stopRepo = manager.getRepository(DeliveryTripStop);
      const partRepo = manager.getRepository(OrderPart);
      const orderRepo = manager.getRepository(Order);

      const trip = await tripRepo.findOne({ where: { id: tripId } });
      if (!trip) throw new NotFoundException('Trip not found');
      if (!canTransitionTrip(trip.status, DeliveryTripStatus.COMPLETED)) {
        throw new ConflictException(
          `A ${trip.status} trip cannot be completed`,
        );
      }

      const stops = await stopRepo.find({ where: { tripId } });
      const outstanding = stops.filter((s) => !s.pickedUpAt);
      if (outstanding.length) {
        throw new ConflictException(
          `${outstanding.length} stop(s) have not been collected — the load is incomplete`,
        );
      }

      for (const stop of stops) {
        const part = await partRepo.findOne({ where: { id: stop.partId } });
        if (part && canTransitionPart(part.status, OrderPartStatus.DELIVERED)) {
          part.status = OrderPartStatus.DELIVERED;
          part.deliveredAt = new Date();
          await partRepo.save(part);
        }
      }

      trip.status = DeliveryTripStatus.COMPLETED;
      trip.completedAt = new Date();
      await tripRepo.save(trip);

      // The ORDER only reaches DELIVERED when every part has — a second truck
      // may still be on the road.
      const parts = await partRepo.find({ where: { orderId: trip.orderId } });
      const live = parts.filter(
        (p) => !FAILED_PART_STATUSES.includes(p.status),
      );
      const allDelivered =
        live.length > 0 &&
        live.every((p) => p.status === OrderPartStatus.DELIVERED);

      if (allDelivered) {
        const order = await orderRepo.findOne({ where: { id: trip.orderId } });
        if (order && order.status !== OrderStatus.DELIVERED) {
          order.status = OrderStatus.DELIVERED;
          await orderRepo.save(order);
        }
      }

      return {
        message: 'Delivery completed',
        trip_id: trip.id,
        order_ready_for_buyer_confirmation: allDelivered,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Reading
  // ────────────────────────────────────────────────────────────────────
  async forOrder(orderId: string) {
    const trips = await this.tripRepo.find({
      where: { orderId },
      relations: ['stops'],
      order: { createdAt: 'ASC' },
    });
    return {
      message: 'Delivery trips fetched',
      order_id: orderId,
      trips: trips.map((t) => this.tripView(t)),
    };
  }

  /** The driver's own view: the trips assigned to them, in route order. */
  async forDriver(odooDriverId: number) {
    const trips = await this.tripRepo.find({
      where: {
        odooDriverId,
        status: In([
          DeliveryTripStatus.ASSIGNED,
          DeliveryTripStatus.IN_PROGRESS,
        ]),
      },
      relations: ['stops'],
      order: { createdAt: 'ASC' },
    });
    return {
      message: 'Trips fetched',
      trips: trips.map((t) => this.tripView(t)),
    };
  }

  private async tripOrThrow(tripId: string): Promise<DeliveryTrip> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  private assertTransition(trip: DeliveryTrip, to: DeliveryTripStatus) {
    if (!canTransitionTrip(trip.status, to)) {
      throw new ConflictException(
        `A ${trip.status} trip cannot become ${to}`,
      );
    }
  }

  private tripView(trip: DeliveryTrip) {
    const stops = [...(trip.stops ?? [])].sort(
      (a, b) => a.sequence - b.sequence,
    );
    return {
      trip_id: trip.id,
      trip_number: trip.tripNumber,
      status: trip.status,
      origin_warehouse_id: trip.originWarehouseId,
      truck_odoo_id: trip.odooTruckId ?? null,
      driver_odoo_id: trip.odooDriverId ?? null,
      driver_name: trip.driverName ?? null,
      driver_phone: trip.driverPhone ?? null,
      route_distance_km: Number(trip.routeDistanceKm),
      delivery_cost: Number(trip.deliveryCost),
      rate_per_km: Number(trip.ratePerKm),
      base_fee: Number(trip.baseFee),
      currency: trip.currency,
      started_at: trip.startedAt ?? null,
      completed_at: trip.completedAt ?? null,
      stops: stops.map((s) => ({
        stop_id: s.id,
        sequence: s.sequence,
        part_id: s.partId,
        warehouse_id: s.warehouseId,
        distance_to_buyer_km: Number(s.distanceToBuyerKm),
        leg_distance_km: Number(s.legDistanceKm),
        leg_cost: Number(s.legCost),
        picked_up_at: s.pickedUpAt ?? null,
        picked_up_note: s.pickedUpNote ?? null,
      })),
    };
  }
}

/** Matches the three-decimal money and distance columns. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
