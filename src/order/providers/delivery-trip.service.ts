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
import { OrderPartLine } from '../entities/order-part-line.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { DeliveryDispatchService } from './delivery-dispatch.service';
import { planDeliveryTrips, PackablePart } from './delivery-capacity-planner';
import { OdooService, DeliveryTripPushPayload } from '@src/odoo/odoo.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { DistanceService } from './distance.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'DELIVERY_TRIP', channel: 'orders' } as const;

/** A material measured in kilograms weighs, per unit, one kilogram. */
const KG_UNIT_CODE = 'KG';

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
  /** The part's weight in kilograms — what capacity planning packs against. */
  weightKg: number;
}

/**
 * A truck the scorer ranked. Identified ONLY by its Odoo id: delivery trucks
 * are not mirrored in the backend, so there is no local row and no local id to
 * carry — the Odoo id is what a trip is stamped with and dispatched by.
 */
type RankedTruck = { odooTruckId: number; maxPayloadKg: number; recentTripCount: number; score: number };

/** The system's chosen truck for a trip. */
type PickedTruck = { odooTruckId: number };

/** A point on the map, and a link that opens it in Google Maps. */
interface MappedPoint {
  latitude: number | null;
  longitude: number | null;
  maps_url: string | null;
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
    @InjectRepository(OrderPartLine)
    private readonly lineRepo: Repository<OrderPartLine>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly rates: DeliveryRateService,
    private readonly dispatch: DeliveryDispatchService,
    private readonly odoo: OdooService,
    private readonly odooSync: OdooSyncService,
    private readonly distance: DistanceService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * A delivery-cost RANGE for a buyer, BEFORE they order — so a factory can see
   * roughly what delivery will add without committing to anything.
   *
   * Two honest bounds, both priced at the rate the backend admin set (per km,
   * plus the base fee and the minimum charge):
   *
   *   BEST  — the whole order comes from the nearest warehouse on ONE truck.
   *           One trip, one base fee, the shortest leg. The cheapest it can be.
   *   WORST — the order is split across as many warehouses as the mode allows,
   *           each sending its OWN truck. The most base fees and the longest
   *           legs. The dearest it can be.
   *
   * The real order lands somewhere between, depending on which warehouses hold
   * the stock and how the load packs — but a buyer deciding whether to order is
   * asking for the range, not the exact figure, and this gives them one without
   * running (or committing) an allocation.
   */
  async estimateDelivery(buyerProfileId: string, provinceId: string) {
    const ranked = await this.distance.rankWarehouses({ buyerProfileId, provinceId });
    if (!ranked.length) {
      return {
        available: false,
        message: 'No active warehouse serves your governorate yet',
      };
    }

    const rate = await this.rates.currentOrFail();
    const ratePerKm = Number(rate.ratePerKm);
    const baseFee = Number(rate.baseFee);
    const quoteOne = (distanceKm: number) => round3(baseFee + ratePerKm * distanceKm);

    // BEST: one truck from the nearest warehouse.
    const best = quoteOne(ranked[0].distanceKm);

    // WORST: split across EVERY candidate warehouse, each sending its own truck
    // — so every leg is charged in full and every truck carries a base fee.
    // There is no artificial cap on how many warehouses an order may split
    // across; the split follows what it takes to cover the order.
    const n = ranked.length;
    const worst = round3(
      ranked.slice(0, n).reduce((sum, w) => sum + quoteOne(w.distanceKm), 0),
    );

    return {
      available: true,
      currency: rate.currency,
      per_km_rate: ratePerKm,
      base_fee: baseFee,
      best_case: {
        trucks: 1,
        cost: best,
        note: 'Whole order from the nearest warehouse, one trip',
      },
      worst_case: {
        trucks: n,
        cost: worst,
        note: `Split across ${n} warehouse(s), each on its own truck`,
      },
      nearest_warehouse_km: round3(ranked[0].distanceKm),
      warehouses_considered: ranked.length,
    };
  }

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

    // A dispatcher's explicit grouping still wins; otherwise the system plans it
    // by weight and picks the trucks itself.
    const plannedGroups = truckGroups?.length
      ? this.resolveGroups(collectables, truckGroups).map((g) => ({
          collectables: g,
          truck: undefined as PickedTruck | undefined,
        }))
      : await this.autoPlanGroups(collectables);
    const rate = await this.rates.currentOrFail();

    const trips: DeliveryTrip[] = [];
    await this.dataSource.transaction(async (manager) => {
      let index = 0;
      for (const group of plannedGroups) {
        index += 1;
        trips.push(
          await this.buildTrip(
            manager,
            order,
            group.collectables,
            rate,
            index,
            plannedGroups.length,
            group.truck,
          ),
        );
      }
    });

    // Dispatch each trip that got a truck: resolve its driver from Odoo, mark it
    // ASSIGNED, and push it so the driver is notified and sees their run. Run
    // AFTER the transaction — it makes a live RPC per trip — and best-effort, so
    // one truck that has no driver never blocks the others' dispatch.
    for (const trip of trips) {
      if (!trip.odooTruckId) continue;
      await this.dispatchTrip(trip.id).catch((e) =>
        winstonLogger.warn(
          `Could not dispatch trip ${trip.tripNumber}: ${(e as Error).message}`,
          LOG_META,
        ),
      );
    }

    const dispatched = await this.tripRepo.find({
      where: { orderId },
      relations: ['stops'],
      order: { createdAt: 'ASC' },
    });
    return {
      message: 'Delivery planned',
      order_id: orderId,
      trip_count: dispatched.length,
      trips: dispatched.map((t) => this.tripView(t)),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Consolidation
  // ────────────────────────────────────────────────────────────────────
  /**
   * Gather a split, NON-delivery order into the ONE warehouse nearest the buyer.
   *
   * The same milk run as a delivery, run by the same delivery truck — but it
   * ENDS AT A WAREHOUSE instead of the buyer's door. The nearest warehouse's own
   * part stays put (why carry what is already at the gathering point?); only the
   * farther warehouses' parts are driven to it, so the buyer then collects the
   * whole order from a single place. The cost is the inter-warehouse route only
   * (base fee + rate × the legs), with no leg to the buyer.
   *
   * Only starts once EVERY warehouse has prepared its part: a truck sent before
   * a warehouse finished would arrive to an empty loading bay and wait.
   */
  async planConsolidationForOrder(orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.fulfilmentMode === FulfilmentMode.DELIVERY) {
      throw new BadRequestException(
        'A delivery order is carried to the buyer, not consolidated',
      );
    }
    if (!order.consolidate) {
      throw new BadRequestException('This order was not set to be consolidated');
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
        'This order already has a live consolidation trip. Cancel it before planning another.',
      );
    }

    // The whole order must be prepared before gathering: every live part sitting
    // in its output zone. A part still being prepared would strand the truck.
    const parts = await this.partRepo.find({ where: { orderId } });
    const live = parts.filter(
      (p) =>
        !FAILED_PART_STATUSES.includes(p.status) &&
        p.status !== OrderPartStatus.CANCELLED,
    );
    if (live.length < 2) {
      throw new BadRequestException(
        'A single-warehouse order has nothing to consolidate',
      );
    }
    const notReady = live.filter((p) => p.status !== OrderPartStatus.IN_OUTPUT_ZONE);
    if (notReady.length) {
      throw new ConflictException(
        'Consolidation waits until every warehouse has prepared its part',
      );
    }

    const collectables = await this.collectablesFor(order);

    // The gathering point: the order's warehouse NEAREST the buyer.
    const point = collectables.reduce((a, b) =>
      a.distanceToBuyerKm <= b.distanceToBuyerKm ? a : b,
    );
    const destWarehouseId = point.warehouseId;
    const farCollectables = collectables.filter((c) => c.warehouseId !== destWarehouseId);
    if (!farCollectables.length) {
      throw new BadRequestException('Every part is already at the nearest warehouse');
    }

    order.consolidationWarehouseId = destWarehouseId;
    await this.orderRepo.save(order);

    const rate = await this.rates.currentOrFail();
    // Each far warehouse's road distance to the gathering point — what orders the
    // route (farthest first) and what the cost is built from.
    const distToDest = new Map<string, number>();
    for (const c of farCollectables) {
      distToDest.set(
        c.warehouseId,
        await this.betweenWarehouses(c.warehouseId, destWarehouseId),
      );
    }

    const groups = await this.autoPlanConsolidationGroups(farCollectables, distToDest);

    const trips: DeliveryTrip[] = [];
    await this.dataSource.transaction(async (manager) => {
      let index = 0;
      for (const group of groups) {
        index += 1;
        trips.push(
          await this.buildConsolidationTrip(
            manager,
            order,
            group.collectables,
            destWarehouseId,
            distToDest,
            rate,
            index,
            groups.length,
            group.truck,
          ),
        );
      }
      // The buyer sees the order move to CONSOLIDATING the moment gathering is
      // planned. Guarded: the order is PREPARING once every part is prepared,
      // which the readiness gate above has just proven.
      const fresh = await manager.getRepository(Order).findOne({ where: { id: order.id } });
      if (fresh && fresh.status === OrderStatus.PREPARING) {
        fresh.status = OrderStatus.CONSOLIDATING;
        await manager.getRepository(Order).save(fresh);
      }
    });

    // Dispatch each trip that got a truck — best-effort, after the transaction,
    // exactly like a delivery run.
    for (const trip of trips) {
      if (!trip.odooTruckId) continue;
      await this.dispatchTrip(trip.id).catch((e) =>
        winstonLogger.warn(
          `Could not dispatch consolidation trip ${trip.tripNumber}: ${(e as Error).message}`,
          LOG_META,
        ),
      );
    }

    const dispatched = await this.tripRepo.find({
      where: { orderId },
      relations: ['stops'],
      order: { createdAt: 'ASC' },
    });
    return {
      message: 'Consolidation planned',
      order_id: orderId,
      consolidation_warehouse_id: destWarehouseId,
      trip_count: dispatched.length,
      trips: dispatched.map((t) => this.tripView(t)),
    };
  }

  /**
   * Groups the FAR parts into trucks by weight, each group a milk run to the
   * gathering point. Identical machinery to a delivery plan, but the distance
   * that orders the packing is each warehouse's distance to the GATHERING
   * WAREHOUSE, not to the buyer.
   */
  private async autoPlanConsolidationGroups(
    farCollectables: Collectable[],
    distToDest: Map<string, number>,
  ): Promise<{ collectables: Collectable[]; truck?: PickedTruck }[]> {
    const warehouseIds = [...new Set(farCollectables.map((c) => c.warehouseId))];
    // The gathering truck accumulates EVERY far part on its way to the nearest
    // warehouse, so it is sized to the total far load — not one warehouse's part.
    const totalFarLoadKg = this.totalLoad(farCollectables);
    const rankings = new Map<string, RankedTruck[]>();
    for (const wh of warehouseIds) {
      rankings.set(wh, await this.dispatch.rankTrucksForWarehouse(wh, totalFarLoadKg));
    }

    const capacityFor = (warehouseId: string): number =>
      rankings.get(warehouseId)?.[0]?.maxPayloadKg ?? 0;

    const packable: PackablePart[] = farCollectables.map((c) => ({
      partId: c.part.id,
      warehouseId: c.warehouseId,
      // The gathering-point distance stands in for "distance to destination".
      distanceToBuyerKm: distToDest.get(c.warehouseId) ?? 0,
      weightKg: c.weightKg,
    }));
    const packed = planDeliveryTrips(packable, capacityFor);

    const pools = new Map<string, RankedTruck[]>(
      [...rankings].map(([wh, list]) => [wh, [...list]]),
    );
    const byPartId = new Map(farCollectables.map((c) => [c.part.id, c]));

    return packed.map((pt) => {
      const groupCollectables = pt.parts
        .map((p) => byPartId.get(p.partId))
        .filter((c): c is Collectable => c != null);
      const pool = pools.get(pt.startWarehouseId) ?? [];
      const chosen = pool.shift();
      return {
        collectables: groupCollectables,
        truck: chosen ? { odooTruckId: chosen.odooTruckId } : undefined,
      };
    });
  }

  /**
   * Builds ONE consolidation trip: the far parts, ordered farthest-from-the-
   * gathering-point first, ending at the gathering warehouse. Cost is the
   * inter-warehouse route; each moved part carries the leg that departs its own
   * warehouse, so a per-warehouse invoice still reconciles to the trip.
   */
  private async buildConsolidationTrip(
    manager: any,
    order: Order,
    group: Collectable[],
    destWarehouseId: string,
    distToDest: Map<string, number>,
    rate: { ratePerKm: string; baseFee: string; currency: string },
    index: number,
    total: number,
    truck?: PickedTruck,
  ): Promise<DeliveryTrip> {
    // Farthest from the gathering point first.
    const stops = [...group].sort(
      (a, b) => (distToDest.get(b.warehouseId) ?? 0) - (distToDest.get(a.warehouseId) ?? 0),
    );
    const legs = await this.consolidationLegDistances(stops, destWarehouseId);

    const ratePerKm = Number(rate.ratePerKm);
    const baseFee = Number(rate.baseFee);
    const routeDistanceKm = round3(legs.reduce((sum, km) => sum + km, 0));
    const deliveryCost = round3(baseFee + ratePerKm * routeDistanceKm);

    const tripRepo = manager.getRepository(DeliveryTrip);
    const stopRepo = manager.getRepository(DeliveryTripStop);
    const partRepo = manager.getRepository(OrderPart);

    const trip = await tripRepo.save(
      tripRepo.create({
        orderId: order.id,
        isConsolidation: true,
        destinationWarehouseId: destWarehouseId,
        tripNumber: this.tripNumber(order, index, total),
        originWarehouseId: stops[0].warehouseId,
        odooTruckId: truck?.odooTruckId,
        status: DeliveryTripStatus.PLANNED,
        routeDistanceKm: String(routeDistanceKm),
        deliveryCost: String(deliveryCost),
        ratePerKm: String(ratePerKm),
        baseFee: String(baseFee),
        currency: rate.currency,
      }),
    );

    for (let i = 0; i < stops.length; i += 1) {
      const legKm = round3(legs[i]);
      const legCost = round3(legKm * ratePerKm + (i === 0 ? baseFee : 0));
      const distKm = round3(distToDest.get(stops[i].warehouseId) ?? 0);

      await stopRepo.save(
        stopRepo.create({
          tripId: trip.id,
          partId: stops[i].part.id,
          warehouseId: stops[i].warehouseId,
          sequence: i + 1,
          // Reused to hold the distance to the GATHERING POINT for this run.
          distanceToBuyerKm: String(distKm),
          legDistanceKm: String(legKm),
          legCost: String(legCost),
        }),
      );

      await partRepo.update(stops[i].part.id, {
        deliveryCost: String(legCost),
        distanceKm: String(distKm),
      });
    }

    trip.stops = await stopRepo.find({
      where: { tripId: trip.id },
      order: { sequence: 'ASC' },
    });
    return trip;
  }

  /**
   * Leg lengths for a consolidation run: stop→stop, and the last stop→gathering
   * warehouse. Every leg is warehouse-to-warehouse (great-circle × road factor)
   * — there is no measured buyer leg, because the goods end at a warehouse.
   */
  private async consolidationLegDistances(
    stops: Collectable[],
    destWarehouseId: string,
  ): Promise<number[]> {
    const legs: number[] = [];
    for (let i = 0; i < stops.length - 1; i += 1) {
      legs.push(
        await this.betweenWarehouses(stops[i].warehouseId, stops[i + 1].warehouseId),
      );
    }
    // The run in: the nearest far warehouse into the gathering warehouse itself.
    legs.push(
      await this.betweenWarehouses(stops[stops.length - 1].warehouseId, destWarehouseId),
    );
    return legs;
  }

  /**
   * Whether the buyer may choose to CONSOLIDATE this order, and — when they may —
   * where it would gather and what it would cost.
   *
   * Available only for a split, NON-delivery order that has not yet reached the
   * point of collection. Delivery is decided at checkout and brings the goods to
   * the buyer, so it never offers consolidation; a single-warehouse order has
   * nothing to gather.
   */
  async consolidationEligibility(order: Order): Promise<{
    available: boolean;
    reason?: string;
    consolidation_warehouse_id?: string;
    estimated_cost?: number;
    currency?: string;
  }> {
    if (order.fulfilmentMode === FulfilmentMode.DELIVERY) {
      return {
        available: false,
        reason:
          'This is a delivery order — it is brought to you via milk-run (one truck from farthest warehouse through nearer ones). For delivery splits, the far warehouse ships to the nearest then the nearest delivers — handled automatically by delivery planning.',
      };
    }
    // Only up to the moment goods are ready to collect; once chosen it stays
    // reported as available so the buyer's screen still shows their choice.
    const inWindow =
      order.status === OrderStatus.AWAITING_APPROVAL ||
      order.status === OrderStatus.PREPARING ||
      order.status === OrderStatus.CONSOLIDATING;
    if (!inWindow && !order.consolidate) {
      return { available: false, reason: 'Consolidation can only be chosen before the order is ready' };
    }

    const parts = await this.partRepo.find({ where: { orderId: order.id } });
    const live = parts.filter(
      (p) =>
        !FAILED_PART_STATUSES.includes(p.status) &&
        p.status !== OrderPartStatus.CANCELLED,
    );
    const warehouses = [...new Set(live.map((p) => p.warehouseId))];
    if (warehouses.length < 2) {
      return { available: false, reason: 'The order is in a single warehouse — nothing to gather' };
    }

    const nearest = await this.nearestWarehouseToBuyer(order.buyerProfileId, warehouses);
    const rate = await this.rates.currentOrFail();
    const distToNearest = new Map<string, number>();
    for (const w of warehouses) {
      if (w !== nearest) {
        distToNearest.set(w, await this.betweenWarehouses(w, nearest));
      }
    }
    const routeKm = await this.consolidationRouteKm(
      warehouses.filter((w) => w !== nearest),
      nearest,
      distToNearest,
    );
    const cost = round3(Number(rate.baseFee) + Number(rate.ratePerKm) * routeKm);
    return {
      available: true,
      consolidation_warehouse_id: nearest,
      estimated_cost: cost,
      currency: rate.currency,
    };
  }

  /**
   * The buyer's choice to consolidate. Records it, and — if every warehouse has
   * already prepared — starts gathering at once; otherwise gathering begins the
   * moment the last warehouse finishes.
   */
  async chooseConsolidation(accountId: string, orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order || order.buyerAccountId !== accountId) {
      throw new NotFoundException('Order not found');
    }

    const elig = await this.consolidationEligibility(order);
    if (!elig.available) {
      throw new BadRequestException(elig.reason ?? 'Consolidation is not available for this order');
    }

    order.consolidate = true;
    order.consolidationWarehouseId = elig.consolidation_warehouse_id ?? null;
    await this.orderRepo.save(order);

    const parts = await this.partRepo.find({ where: { orderId } });
    const live = parts.filter(
      (p) =>
        !FAILED_PART_STATUSES.includes(p.status) &&
        p.status !== OrderPartStatus.CANCELLED,
    );
    const allReady =
      live.length >= 2 && live.every((p) => p.status === OrderPartStatus.IN_OUTPUT_ZONE);
    if (allReady) {
      return this.planConsolidationForOrder(orderId);
    }
    return {
      message:
        'Consolidation chosen — gathering will begin once every warehouse has prepared its part',
      order_id: orderId,
      consolidation_warehouse_id: elig.consolidation_warehouse_id,
      estimated_cost: elig.estimated_cost,
      currency: elig.currency,
    };
  }

  /** The warehouse in `warehouseIds` nearest the buyer (measured cache). */
  private async nearestWarehouseToBuyer(
    buyerProfileId: string,
    warehouseIds: string[],
  ): Promise<string> {
    const dists = await this.distancesToBuyer(buyerProfileId, warehouseIds);
    let nearest = warehouseIds[0];
    let best = dists.get(nearest) ?? Number.POSITIVE_INFINITY;
    for (const w of warehouseIds) {
      const d = dists.get(w) ?? Number.POSITIVE_INFINITY;
      if (d < best) {
        best = d;
        nearest = w;
      }
    }
    return nearest;
  }

  /**
   * The milk-run route length for a consolidation: farthest-from-the-gathering-
   * point first, then each leg to the next, ending at the gathering warehouse.
   * Same ordering the real trip uses, so the estimate matches a single-truck run.
   */
  private async consolidationRouteKm(
    farWarehouseIds: string[],
    nearestId: string,
    distToNearest: Map<string, number>,
  ): Promise<number> {
    if (!farWarehouseIds.length) return 0;
    const ordered = [...farWarehouseIds].sort(
      (a, b) => (distToNearest.get(b) ?? 0) - (distToNearest.get(a) ?? 0),
    );
    let km = 0;
    for (let i = 0; i < ordered.length - 1; i += 1) {
      km += await this.betweenWarehouses(ordered[i], ordered[i + 1]);
    }
    km += await this.betweenWarehouses(ordered[ordered.length - 1], nearestId);
    return round3(km);
  }

  /**
   * Dispatches a planned trip: finds the driver of its chosen truck in Odoo,
   * marks the trip ASSIGNED, and queues the push that makes it appear on the
   * driver's dashboard.
   *
   * A truck with no active driver leaves the trip PLANNED rather than pretending
   * it is on the road — a human assigns a driver to the truck in Odoo and the
   * trip is dispatched on the next attempt.
   */
  async dispatchTrip(tripId: string) {
    const trip = await this.tripRepo.findOne({
      where: { id: tripId },
      relations: ['stops'],
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (!trip.odooTruckId) {
      throw new BadRequestException('This trip has no truck to dispatch');
    }
    if (
      trip.status !== DeliveryTripStatus.PLANNED &&
      trip.status !== DeliveryTripStatus.ASSIGNED
    ) {
      throw new ConflictException(`A ${trip.status} trip cannot be dispatched`);
    }

    const driver = await this.odoo.fetchDeliveryDriverForTruck(trip.odooTruckId);
    if (!driver?.driver_id) {
      winstonLogger.warn(
        `Trip ${trip.tripNumber}: truck ${trip.odooTruckId} has no active driver — left planned`,
        LOG_META,
      );
      return { message: 'No driver available for the chosen truck', dispatched: false };
    }

    trip.odooDriverId = driver.driver_id;
    trip.driverName = driver.name ?? null as unknown as undefined;
    trip.driverPhone = driver.phone ?? null as unknown as undefined;
    if (trip.status === DeliveryTripStatus.PLANNED) {
      this.assertTransition(trip, DeliveryTripStatus.ASSIGNED);
      trip.status = DeliveryTripStatus.ASSIGNED;
    }
    await this.tripRepo.save(trip);

    const payload = await this.buildPushPayload(trip);
    await this.odooSync.enqueuePushDeliveryTrip({ trip: payload });
    return { message: 'Trip dispatched', dispatched: true, trip: this.tripView(trip) };
  }

  /** The push shape: the trip, its stops, every point's coordinates, the driver. */
  private async buildPushPayload(
    trip: DeliveryTrip,
  ): Promise<DeliveryTripPushPayload> {
    const order = await this.orderRepo.findOne({ where: { id: trip.orderId } });
    const stops = [...(trip.stops ?? [])].sort((a, b) => a.sequence - b.sequence);

    const warehouseIds = [
      ...new Set([
        ...stops.map((s) => s.warehouseId),
        trip.originWarehouseId,
        ...(trip.destinationWarehouseId ? [trip.destinationWarehouseId] : []),
      ]),
    ];
    const [whInfo, coords, buyer, summaries] = await Promise.all([
      this.warehouseOdooIds(warehouseIds),
      this.warehouseCoords(warehouseIds),
      this.buyerPoint(order?.buyerProfileId ?? ''),
      this.stopSummaries(stops.map((s) => s.partId)),
    ]);

    // A consolidation run ends at the GATHERING WAREHOUSE, so the driver's
    // destination is that warehouse — never the buyer, who collects there later.
    const dest =
      trip.isConsolidation && trip.destinationWarehouseId
        ? coords.get(trip.destinationWarehouseId) ?? { lat: null, lng: null }
        : { lat: buyer.lat, lng: buyer.lng };

    return {
      backend_trip_id: trip.id,
      trip_number: trip.tripNumber,
      order_number: order?.orderNumber ?? '',
      // The order's UUID — the join key Odoo uses to hang this trip's delivery
      // cost onto the order (recycle.order.backend_order_id holds the same id).
      backend_order_id: order?.id ?? '',
      buyer_name: order ? await this.buyerName(order.buyerAccountId) : '',
      origin_warehouse_odoo_id: whInfo.get(trip.originWarehouseId) ?? null,
      truck_odoo_id: trip.odooTruckId ?? null,
      driver_odoo_id: trip.odooDriverId ?? null,
      status: 'assigned',
      route_distance_km: Number(trip.routeDistanceKm),
      delivery_cost: Number(trip.deliveryCost),
      currency: trip.currency,
      dest_latitude: dest.lat,
      dest_longitude: dest.lng,
      stops: stops.map((s) => {
        const c = coords.get(s.warehouseId) ?? { lat: null, lng: null };
        return {
          backend_stop_id: s.id,
          sequence: s.sequence,
          warehouse_odoo_id: whInfo.get(s.warehouseId) ?? null,
          part_ref: s.partId,
          product_summary: summaries.get(s.partId) ?? '',
          distance_to_buyer_km: Number(s.distanceToBuyerKm),
          latitude: c.lat,
          longitude: c.lng,
          picked_up_at: s.pickedUpAt ? s.pickedUpAt.toISOString() : null,
        };
      }),
    };
  }

  /** Odoo warehouse ids, by backend id. */
  private async warehouseOdooIds(
    ids: string[],
  ): Promise<Map<string, number | null>> {
    const map = new Map<string, number | null>();
    if (!ids.length) return map;
    const rows = await this.tripRepo.query(
      `SELECT id, odoo_warehouse_id FROM warehouses WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    for (const r of rows) {
      map.set(r.id, r.odoo_warehouse_id != null ? Number(r.odoo_warehouse_id) : null);
    }
    return map;
  }

  /** A short "what is being collected" per part, for the driver's screen. */
  private async stopSummaries(
    partIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!partIds.length) return out;
    const lines = await this.lineRepo.find({ where: { partId: In(partIds) } });
    const byPart = new Map<string, string[]>();
    for (const line of lines) {
      const list = byPart.get(line.partId) ?? [];
      list.push(`${line.productName} × ${Number(line.quantity)} ${line.unitType}`);
      byPart.set(line.partId, list);
    }
    for (const [partId, items] of byPart) out.set(partId, items.join(', '));
    return out;
  }

  private async buyerName(buyerAccountId: string): Promise<string> {
    const rows = await this.tripRepo.query(
      `SELECT name FROM accounts WHERE id = $1 LIMIT 1`,
      [buyerAccountId],
    );
    return rows.length ? rows[0].name ?? '' : '';
  }

  /**
   * Applies a pickup a driver confirmed in Odoo. Reuses the same custody logic
   * as the direct route — Odoo has already enforced the order, so this records
   * what it confirmed.
   */
  async applyOdooPickup(backendTripId: string, backendStopId: string) {
    return this.confirmPickup(backendTripId, backendStopId);
  }

  /** Applies a completion the driver confirmed in Odoo. */
  async applyOdooComplete(backendTripId: string) {
    return this.completeTrip(backendTripId);
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
    const weights = await this.partWeights(live.map((p) => p.id));

    return live.map((part) => ({
      part,
      warehouseId: part.warehouseId,
      distanceToBuyerKm: distances.get(part.warehouseId) ?? 0,
      weightKg: weights.get(part.id) ?? 0,
    }));
  }

  /**
   * Each part's weight in kilograms.
   *
   * A line measured in kilograms weighs its quantity; anything else is converted
   * through the material's per-unit weight, which the admin is REQUIRED to set
   * for a non-kg material precisely so a load can be weighed against a truck.
   * A missing weight contributes zero rather than throwing — the capacity plan
   * degrades to "lighter than it is" rather than blocking a delivery, and the
   * gap is a data problem to fix upstream, not here at dispatch time.
   */
  private async partWeights(partIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!partIds.length) return out;

    const lines = await this.lineRepo.find({ where: { partId: In(partIds) } });
    if (!lines.length) return out;

    const products = await this.productRepo.find({
      where: { id: In([...new Set(lines.map((l) => l.productId))]) },
    });
    const weightByProduct = new Map(
      products.map((p) => [p.id, p.unitWeightKg != null ? Number(p.unitWeightKg) : null]),
    );

    for (const line of lines) {
      const qty = Number(line.quantity);
      const perUnit =
        (line.unitType || '').toUpperCase() === KG_UNIT_CODE
          ? 1
          : weightByProduct.get(line.productId) ?? 0;
      const current = out.get(line.partId) ?? 0;
      out.set(line.partId, round3(current + qty * perUnit));
    }
    return out;
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

  /**
   * The system's own plan: group the parts into trucks by weight, and pick the
   * truck each trip runs on.
   *
   * Farthest warehouse first, each trip filled to its truck's capacity before
   * the overflow starts the next — and the truck for a trip is the best-scored
   * DELIVERY vehicle of the warehouse it sets out from. When a second trip
   * departs the same warehouse, the next-best truck is taken so one vehicle is
   * never chosen twice.
   */
  private async autoPlanGroups(
    collectables: Collectable[],
  ): Promise<{ collectables: Collectable[]; truck?: PickedTruck }[]> {
    const warehouseIds = [...new Set(collectables.map((c) => c.warehouseId))];
    // The whole order's load: the milk-run truck accumulates every part on its
    // way to the buyer, so any warehouse it might set out from is sized to carry
    // the total — not just the part waiting there.
    const totalLoadKg = this.totalLoad(collectables);
    const rankings = new Map<string, RankedTruck[]>();
    for (const wh of warehouseIds) {
      rankings.set(wh, await this.dispatch.rankTrucksForWarehouse(wh, totalLoadKg));
    }

    const capacityFor = (warehouseId: string): number =>
      rankings.get(warehouseId)?.[0]?.maxPayloadKg ?? 0;

    const packable: PackablePart[] = collectables.map((c) => ({
      partId: c.part.id,
      warehouseId: c.warehouseId,
      distanceToBuyerKm: c.distanceToBuyerKm,
      weightKg: c.weightKg,
    }));
    const packed = planDeliveryTrips(packable, capacityFor);

    // A mutable pool per warehouse, so two trips from one warehouse take two
    // different trucks.
    const pools = new Map<string, RankedTruck[]>(
      [...rankings].map(([wh, list]) => [wh, [...list]]),
    );
    const byPartId = new Map(collectables.map((c) => [c.part.id, c]));

    return packed.map((pt) => {
      const groupCollectables = pt.parts
        .map((p) => byPartId.get(p.partId))
        .filter((c): c is Collectable => c != null);
      const pool = pools.get(pt.startWarehouseId) ?? [];
      const chosen = pool.shift();
      return {
        collectables: groupCollectables,
        truck: chosen ? { odooTruckId: chosen.odooTruckId } : undefined,
      };
    });
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

  /**
   * The WHOLE trip's load in kilograms — the fit signal for truck selection.
   *
   * Not each warehouse's own part: a milk-run truck sets out from one warehouse
   * but ACCUMULATES every part it passes on the way to the buyer, so it must be
   * sized to carry the total. Sizing it to the far warehouse's small part would
   * pick a truck too small for what it then collects, and the milk run collapses
   * into a separate van per warehouse. For a single-warehouse (unsplit) order
   * this total is simply that one warehouse's load — which is correct.
   */
  private totalLoad(collectables: Collectable[]): number {
    return round3(collectables.reduce((sum, c) => sum + c.weightKg, 0));
  }

  private async buildTrip(
    manager: any,
    order: Order,
    group: Collectable[],
    rate: { ratePerKm: string; baseFee: string; currency: string },
    index: number,
    total: number,
    truck?: PickedTruck,
  ): Promise<DeliveryTrip> {
    const stops = this.orderStops(group);
    const legs = await this.legDistances(stops, order.buyerProfileId);

    const ratePerKm = Number(rate.ratePerKm);
    const baseFee = Number(rate.baseFee);

    const routeDistanceKm = round3(legs.reduce((sum, km) => sum + km, 0));
    // Base fee sits on the FIRST stop — the leg that begins the journey — so
    // the stops' costs still add up to the trip's cost exactly.
    const deliveryCost = round3(baseFee + ratePerKm * routeDistanceKm);

    const tripRepo = manager.getRepository(DeliveryTrip);
    const stopRepo = manager.getRepository(DeliveryTripStop);
    const partRepo = manager.getRepository(OrderPart);

    const trip = await tripRepo.save(
      tripRepo.create({
        orderId: order.id,
        tripNumber: this.tripNumber(order, index, total),
        originWarehouseId: stops[0].warehouseId,
        // The system's pick, recorded at plan time; the driver and the ASSIGNED
        // transition follow when the trip is dispatched to Odoo. Null when the
        // origin warehouse had no eligible truck — a human then assigns one.
        odooTruckId: truck?.odooTruckId,
        status: DeliveryTripStatus.PLANNED,
        routeDistanceKm: String(routeDistanceKm),
        deliveryCost: String(deliveryCost),
        ratePerKm: String(ratePerKm),
        baseFee: String(baseFee),
        currency: rate.currency,
      }),
    );

    for (let i = 0; i < stops.length; i += 1) {
      const legKm = round3(legs[i]);
      const legCost = round3(legKm * ratePerKm + (i === 0 ? baseFee : 0));

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

      // A delivery hands the parts to the BUYER (DELIVERED); a consolidation
      // drops them at the GATHERING WAREHOUSE, where they wait for the buyer to
      // collect (READY_FOR_PICKUP) — dispatched from their origin, not yet gone.
      const arrived = trip.isConsolidation
        ? OrderPartStatus.READY_FOR_PICKUP
        : OrderPartStatus.DELIVERED;
      for (const stop of stops) {
        const part = await partRepo.findOne({ where: { id: stop.partId } });
        if (part && canTransitionPart(part.status, arrived)) {
          part.status = arrived;
          if (arrived === OrderPartStatus.DELIVERED) part.deliveredAt = new Date();
          await partRepo.save(part);
        }
      }

      trip.status = DeliveryTripStatus.COMPLETED;
      trip.completedAt = new Date();
      await tripRepo.save(trip);

      const parts = await partRepo.find({ where: { orderId: trip.orderId } });
      const live = parts.filter((p) => !FAILED_PART_STATUSES.includes(p.status));
      const order = await orderRepo.findOne({ where: { id: trip.orderId } });

      if (trip.isConsolidation) {
        // Every FAR part gathered? Then the nearest part (which never moved)
        // joins them, and the buyer may collect the whole order from the one
        // warehouse. A second consolidation truck may still be on the road.
        const farGathered =
          live.length > 0 &&
          live
            .filter((p) => p.warehouseId !== order?.consolidationWarehouseId)
            .every((p) => p.status === OrderPartStatus.READY_FOR_PICKUP);
        if (farGathered) {
          for (const p of live.filter(
            (p) => p.warehouseId === order?.consolidationWarehouseId,
          )) {
            if (canTransitionPart(p.status, OrderPartStatus.READY_FOR_PICKUP)) {
              p.status = OrderPartStatus.READY_FOR_PICKUP;
              await partRepo.save(p);
            }
          }
          if (order && order.status === OrderStatus.CONSOLIDATING) {
            order.status = OrderStatus.READY_FOR_PICKUP;
            await orderRepo.save(order);
          }
        }
        return {
          message: 'Consolidation completed',
          trip_id: trip.id,
          order_ready_for_pickup: farGathered,
        };
      }

      // Delivery: the ORDER only reaches DELIVERED when every part has.
      const allDelivered =
        live.length > 0 &&
        live.every((p) => p.status === OrderPartStatus.DELIVERED);
      if (allDelivered && order && order.status !== OrderStatus.DELIVERED) {
        order.status = OrderStatus.DELIVERED;
        await orderRepo.save(order);
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
  /**
   * The ADMIN's delivery-stages view for an order: every trip, every station,
   * each station's status and pickup time, and every point as coordinates with
   * a Google Maps link. This is the screen that answers "where is my order".
   */
  async forOrder(orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    const trips = await this.tripRepo.find({
      where: { orderId },
      relations: ['stops'],
      order: { createdAt: 'ASC' },
    });
    const views = [];
    for (const trip of trips) {
      views.push(
        await this.enrichedTripView(trip, order?.buyerProfileId ?? '', {
          driverView: false,
        }),
      );
    }
    return { message: 'Delivery trips fetched', order_id: orderId, trips: views };
  }

  /**
   * The DRIVER's view: their live trips, each showing ONLY the next station to
   * drive to — not the whole route. A station opens when the one before it has
   * been collected, so the driver always sees exactly where to go next and its
   * map pin, and nothing further to distract or pre-empt the route.
   */
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
    const orderIds = [...new Set(trips.map((t) => t.orderId))];
    const orders = orderIds.length
      ? await this.orderRepo.find({ where: { id: In(orderIds) } })
      : [];
    const buyerByOrder = new Map(orders.map((o) => [o.id, o.buyerProfileId]));

    const views = [];
    for (const trip of trips) {
      views.push(
        await this.enrichedTripView(trip, buyerByOrder.get(trip.orderId) ?? '', {
          driverView: true,
        }),
      );
    }
    return { message: 'Trips fetched', trips: views };
  }

  /** Warehouse pins, by id. */
  private async warehouseCoords(
    ids: string[],
  ): Promise<Map<string, { lat: number | null; lng: number | null }>> {
    const map = new Map<string, { lat: number | null; lng: number | null }>();
    if (!ids.length) return map;
    const rows = await this.tripRepo.query(
      `SELECT id, latitude, longitude FROM warehouses WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    for (const r of rows) {
      map.set(r.id, {
        lat: r.latitude != null ? Number(r.latitude) : null,
        lng: r.longitude != null ? Number(r.longitude) : null,
      });
    }
    return map;
  }

  /** The buyer's pin — the trip's final destination. */
  private async buyerPoint(
    buyerProfileId: string,
  ): Promise<{ lat: number | null; lng: number | null }> {
    if (!buyerProfileId) return { lat: null, lng: null };
    const rows = await this.tripRepo.query(
      `SELECT ST_Y(coordinates::geometry) AS lat, ST_X(coordinates::geometry) AS lng
         FROM (
           SELECT coordinates FROM factory_profiles WHERE id = $1
           UNION ALL
           SELECT coordinates FROM external_partner_profiles WHERE id = $1
         ) p
        WHERE coordinates IS NOT NULL
        LIMIT 1`,
      [buyerProfileId],
    );
    if (!rows.length) return { lat: null, lng: null };
    return { lat: Number(rows[0].lat), lng: Number(rows[0].lng) };
  }

  /**
   * A trip with its stops mapped and dated. `driverView` shows only the next
   * station; the admin view shows the whole run.
   */
  private async enrichedTripView(
    trip: DeliveryTrip,
    buyerProfileId: string,
    opts: { driverView: boolean },
  ) {
    const stops = [...(trip.stops ?? [])].sort((a, b) => a.sequence - b.sequence);
    const whCoords = await this.warehouseCoords([
      ...new Set([...stops.map((s) => s.warehouseId), trip.originWarehouseId]),
    ]);
    const buyer = await this.buyerPoint(buyerProfileId);
    const nextStop = stops.find((s) => !s.pickedUpAt) ?? null;

    const stopView = (s: DeliveryTripStop) => {
      const c = whCoords.get(s.warehouseId) ?? { lat: null, lng: null };
      return {
        stop_id: s.id,
        sequence: s.sequence,
        part_id: s.partId,
        warehouse_id: s.warehouseId,
        distance_to_buyer_km: Number(s.distanceToBuyerKm),
        leg_distance_km: Number(s.legDistanceKm),
        leg_cost: Number(s.legCost),
        picked_up_at: s.pickedUpAt ?? null,
        picked_up_note: s.pickedUpNote ?? null,
        status: s.pickedUpAt
          ? 'PICKED_UP'
          : nextStop && s.id === nextStop.id
            ? 'CURRENT'
            : 'PENDING',
        location: this.pointView(c.lat, c.lng),
      };
    };

    return {
      trip_id: trip.id,
      trip_number: trip.tripNumber,
      status: trip.status,
      origin_warehouse_id: trip.originWarehouseId,
      truck_odoo_id: trip.odooTruckId ?? null,
      // The driver as one object — odoo id, name, phone — not a scattered trio.
      driver: {
        odoo_id: trip.odooDriverId ?? null,
        name: trip.driverName ?? null,
        phone: trip.driverPhone ?? null,
      },
      route_distance_km: Number(trip.routeDistanceKm),
      delivery_cost: Number(trip.deliveryCost),
      currency: trip.currency,
      started_at: trip.startedAt ?? null,
      completed_at: trip.completedAt ?? null,
      // The buyer, where every trip ends.
      destination: this.pointView(buyer.lat, buyer.lng),
      total_stops: stops.length,
      remaining_stops: stops.filter((s) => !s.pickedUpAt).length,
      next_stop: nextStop ? stopView(nextStop) : null,
      // Driver: only where to go next. Admin: the whole run.
      stops: opts.driverView
        ? nextStop
          ? [stopView(nextStop)]
          : []
        : stops.map(stopView),
    };
  }

  private pointView(lat: number | null, lng: number | null): MappedPoint {
    return { latitude: lat, longitude: lng, maps_url: googleMapsUrl(lat, lng) };
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
      // The driver as one object — odoo id, name, phone — not a scattered trio.
      driver: {
        odoo_id: trip.odooDriverId ?? null,
        name: trip.driverName ?? null,
        phone: trip.driverPhone ?? null,
      },
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

/**
 * A Google Maps link that drops a pin at the coordinates. Tapped on a phone it
 * opens the Maps app on that exact point — which is all the driver needs to
 * navigate to the next station.
 */
function googleMapsUrl(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
