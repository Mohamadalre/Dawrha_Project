import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { HandoverStatus } from '@src/truck/enums/handover-status.enum';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { PointsWalletService } from '@src/points-wallet/points-wallet.service';
import { NotificationService } from '@src/notification/notification.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestLine } from '../entities/collection-request-line.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { CollectionStateService } from '../providers/collection-state.service';
import { DispatchConfigProvider } from '../providers/dispatch-config.provider';
import { DispatchEngineService } from './dispatch-engine.service';
import { DispatchGatewayEvents } from '../gateways/dispatch.gateway';
import { planRoute, RouteStop, DEFAULT_ROUTE_CONSTRAINTS } from '../providers/route-planner';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionRouteStatus } from '../enums/collection-route-status.enum';
import {
  CollectionActualWeightRequiredException,
  CollectionDriverProfileNotFoundException,
  CollectionRouteNotFoundException,
  CollectionStopNotOnTourException,
  CollectionWarehouseNotFoundException,
} from '../exceptions/collection-request.exceptions';

const LOG_META = { context: 'ROUTE_EXECUTION', channel: 'collection' } as const;

/** Statuses that still need work on a tour (everything not done/cancelled). */
const ACTIVE_STOP_STATUSES: CollectionRequestStatus[] = [
  CollectionRequestStatus.ASSIGNED,
  CollectionRequestStatus.EN_ROUTE,
  CollectionRequestStatus.ARRIVED,
  CollectionRequestStatus.PICKING,
];

export interface DriverTourView {
  route: {
    route_id: string | null;
    route_number: string | null;
    status: CollectionRouteStatus | null;
  } | null;
  stops: {
    request_id: string;
    request_number: string;
    status: CollectionRequestStatus;
    route_sequence: number | null;
    address_text: string | null;
    lat: number | null;
    lng: number | null;
    scheduled_at: Date | null;
    estimated_weight_kg: number;
    is_next: boolean;
  }[];
  next_request_id: string | null;
}

/**
 * The driver's execution of his tour: arrive, weigh, deliver. This is where a
 * request becomes reality — the snapshots of Sprint 1 turn into actuals, the
 * route starts and closes, and the freed driver hands the queue back to the
 * dispatch engine.
 */
@Injectable()
export class RouteExecutionService {
  private readonly logger = new Logger('ROUTE_EXECUTION');

  constructor(
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(CollectionRoute)
    private readonly routeRepo: Repository<CollectionRoute>,
    @InjectRepository(CollectionRequestLine)
    private readonly lineRepo: Repository<CollectionRequestLine>,
    @InjectRepository(CollectorProfile)
    private readonly profileRepo: Repository<CollectorProfile>,
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly state: CollectionStateService,
    private readonly configProvider: DispatchConfigProvider,
    private readonly engine: DispatchEngineService,
    private readonly odooSync: OdooSyncService,
    private readonly wallet: PointsWalletService,
    private readonly notifications: NotificationService,
    private readonly events: DispatchGatewayEvents,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Driver's view
  // ---------------------------------------------------------------------------
  async myTour(caller: { id: string; role: string }): Promise<DriverTourView> {
    const profile = await this.loadDriver(caller.id);
    const route = await this.activeRouteOf(profile.id);
    if (!route) {
      return { route: null, stops: [], next_request_id: null };
    }

    const stops = (route.requests ?? [])
      .slice()
      .sort((a, b) => (a.routeSequence ?? Infinity) - (b.routeSequence ?? Infinity));
    const next =
      stops.find((s) => ACTIVE_STOP_STATUSES.includes(s.status)) ??
      stops.find((s) => s.status === CollectionRequestStatus.DELIVERED);

    return {
      route: {
        route_id: route.id,
        route_number: route.routeNumber,
        status: route.status,
      },
      stops: stops.map((s) => ({
        request_id: s.id,
        request_number: s.requestNumber,
        status: s.status,
        route_sequence: s.routeSequence ?? null,
        address_text: s.addressText ?? null,
        lat: s.lat != null ? Number(s.lat) : null,
        lng: s.lng != null ? Number(s.lng) : null,
        scheduled_at: s.scheduledAt ?? null,
        estimated_weight_kg: Number(s.estimatedWeightKg),
        is_next: s.id === next?.id,
      })),
      next_request_id: next?.id ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // The stop lifecycle
  // ---------------------------------------------------------------------------
  async arrived(caller: { id: string; role: string }, requestId: string): Promise<void> {
    const { profile, route, stop } = await this.loadStop(caller.id, requestId);

    // Idempotent: a retried PATCH after a lost response must not 409.
    if (stop.status === CollectionRequestStatus.ARRIVED) return;

    if (stop.status === CollectionRequestStatus.ASSIGNED) {
      this.state.applyRequestStatus(stop, CollectionRequestStatus.EN_ROUTE);
      stop.enRouteAt = new Date();
      if (route.status === CollectionRouteStatus.PLANNED) {
        this.state.applyRouteStatus(route, CollectionRouteStatus.IN_PROGRESS);
        await this.routeRepo.save(route);
        await this.reorderTour(route, profile.id);
      }
    }
    this.state.applyRequestStatus(stop, CollectionRequestStatus.ARRIVED);
    stop.arrivedAt = new Date();
    await this.requestRepo.save(stop);

    this.events.announceToRequest(stop.id, 'request:status', this.statusPayload(stop));
    winstonLogger.info(
      `Collection request ${stop.requestNumber}: driver arrived (route ${route.routeNumber})`,
      LOG_META,
    );
  }

  async collected(
    caller: { id: string; role: string },
    requestId: string,
    dto: { actualWeightKg: number },
  ): Promise<void> {
    const { route, stop } = await this.loadStop(caller.id, requestId);
    if (stop.status === CollectionRequestStatus.PICKING) return;

    const actual = Number(dto.actualWeightKg);
    if (!(actual > 0)) throw new CollectionActualWeightRequiredException();

    const estimated = Number(stop.estimatedWeightKg);
    stop.actualWeightKg = String(actual);
    stop.actualGrandTotal =
      estimated > 0
        ? String(+(Number(stop.estimatedGrandTotal) * (actual / estimated)).toFixed(2))
        : stop.estimatedGrandTotal;

    this.state.applyRequestStatus(stop, CollectionRequestStatus.PICKING);
    stop.pickedAt = new Date();
    await this.requestRepo.save(stop);

    this.events.announceToRequest(stop.id, 'request:status', this.statusPayload(stop));
    winstonLogger.info(
      `Collection request ${stop.requestNumber}: weighed ${actual} kg (route ${route.routeNumber})`,
      LOG_META,
    );
  }

  async delivered(
    caller: { id: string; role: string },
    requestId: string,
    dto: { warehouseId?: string },
  ): Promise<void> {
    const { profile, route, stop } = await this.loadStop(caller.id, requestId);
    if (stop.status === CollectionRequestStatus.DELIVERED) return;

    let warehouseOdooId: number | null = null;
    if (dto.warehouseId) {
      const warehouse = await this.warehouseRepo.findOne({
        where: { id: dto.warehouseId },
      });
      if (!warehouse) throw new CollectionWarehouseNotFoundException();
      warehouseOdooId = warehouse.odooWarehouseId ?? null;
    }

    this.state.applyRequestStatus(stop, CollectionRequestStatus.DELIVERED);
    stop.deliveredAt = new Date();
    await this.requestRepo.save(stop);

    await this.registerIntake(stop, warehouseOdooId);
    this.events.announceToRequest(stop.id, 'request:status', this.statusPayload(stop));
    winstonLogger.info(
      `Collection request ${stop.requestNumber}: delivered to ${warehouseOdooId ?? 'origin'} (route ${route.routeNumber})`,
      LOG_META,
    );

    await this.advanceRoute(route, profile.id);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async loadDriver(accountId: string): Promise<CollectorProfile> {
    const profile = await this.profileRepo.findOne({
      where: { account: { id: accountId } },
    });
    if (!profile) throw new CollectionDriverProfileNotFoundException();
    return profile;
  }

  private async activeRouteOf(driverId: string): Promise<CollectionRoute | null> {
    return this.routeRepo.findOne({
      where: {
        driverId,
        status: In([CollectionRouteStatus.PLANNED, CollectionRouteStatus.IN_PROGRESS]),
      },
      order: { createdAt: 'ASC' },
      relations: ['requests'],
    });
  }

  private async loadStop(
    accountId: string,
    requestId: string,
  ): Promise<{ profile: CollectorProfile; route: CollectionRoute; stop: CollectionRequest }> {
    const profile = await this.loadDriver(accountId);
    const route = await this.activeRouteOf(profile.id);
    if (!route) throw new CollectionRouteNotFoundException();
    const stop = (route.requests ?? []).find((r) => r.id === requestId);
    if (!stop) throw new CollectionStopNotOnTourException();
    return { profile, route, stop };
  }

  private statusPayload(request: CollectionRequest) {
    return {
      request_id: request.id,
      request_number: request.requestNumber,
      status: request.status,
      route_id: request.routeId ?? null,
      route_sequence: request.routeSequence ?? null,
      updated_at: new Date(),
    };
  }

  /** Orders the still-open stops once the tour starts (the RoutePlanner). */
  private async reorderTour(route: CollectionRoute, driverId: string): Promise<void> {
    const stops = (route.requests ?? [])
      .slice()
      .sort((a, b) => (a.routeSequence ?? Infinity) - (b.routeSequence ?? Infinity));
    const open = stops.filter((s) => ACTIVE_STOP_STATUSES.includes(s.status));
    if (open.length < 2) return;

    const origin = await this.originOf(driverId);
    const config = await this.configProvider.get();
    const plan = planRoute({
      stops: open.map((s) => this.wrapStop(s)),
      origin: origin ?? null,
      now: new Date(),
      constraints: {
        mergeMaxMinutes: config.routeMergeMaxMin,
        mergeMaxKm:
          Number(config.routeMergeMaxKm) || DEFAULT_ROUTE_CONSTRAINTS.mergeMaxKm,
        institutionToleranceMin: config.institutionToleranceMin,
      },
    });
    if (!plan.feasible || plan.stopIds.length !== open.length) {
      this.logger.warn(`Tour reorder abandoned for route ${route.routeNumber}: not feasible`);
      return;
    }
    await this.applyOrder(route, plan.stopIds, open);
  }

  private async applyOrder(
    route: CollectionRoute,
    orderedIds: string[],
    openStops: CollectionRequest[],
  ): Promise<void> {
    const byId = new Map(openStops.map((s) => [s.id, s]));
    const saved: CollectionRequest[] = [];
    orderedIds.forEach((id, i) => {
      const stop = byId.get(id);
      if (stop && stop.routeSequence !== i + 1) {
        stop.routeSequence = i + 1;
        saved.push(stop);
      }
    });
    if (saved.length) {
      await this.requestRepo.save(saved);
      winstonLogger.info(
        `Route ${route.routeNumber}: tour reordered to ${orderedIds.join(' -> ')}`,
        LOG_META,
      );
    }
  }

  /** The driver's current position: his session's origin warehouse, if any. */
  private async originOf(driverId: string): Promise<{ lat: number; lng: number } | null> {
    const handover = await this.handoverRepo.findOne({
      where: { driverId, status: HandoverStatus.OPEN },
      relations: ['warehouse'],
    });
    const warehouse = handover?.warehouse;
    if (!warehouse || warehouse.latitude == null || warehouse.longitude == null) return null;
    return { lat: Number(warehouse.latitude), lng: Number(warehouse.longitude) };
  }

  private wrapStop(request: CollectionRequest): RouteStop {
    return {
      requestId: request.id,
      lat: Number(request.lat),
      lng: Number(request.lng),
      scheduledAt: request.scheduledAt ?? null,
    };
  }

  /** After a delivery: close the tour when nothing is left, else free the driver. */
  private async advanceRoute(route: CollectionRoute, driverId: string): Promise<void> {
    const stops = (route.requests ?? [])
      .slice()
      .sort((a, b) => (a.routeSequence ?? Infinity) - (b.routeSequence ?? Infinity));
    const remaining = stops.filter((s) => ACTIVE_STOP_STATUSES.includes(s.status));

    if (remaining.length === 0) {
      this.state.applyRouteStatus(route, CollectionRouteStatus.COMPLETED);
      await this.routeRepo.save(route);

      const toClose = stops.filter((s) => s.status === CollectionRequestStatus.DELIVERED);
      for (const stop of toClose) {
        this.state.applyRequestStatus(stop, CollectionRequestStatus.COMPLETED);
        await this.requestRepo.save(stop);
        this.events.announceToRequest(stop.id, 'request:status', this.statusPayload(stop));
        await this.awardPoints(stop);
      }
      winstonLogger.info(
        `Route ${route.routeNumber}: tour complete (${toClose.length} stop(s) closed)`,
        LOG_META,
      );
    }

    // A freed driver (one more stop done, or the whole tour) means the engine
    // may inject the oldest queued request into this route.
    this.eventEmitter.emit('collection.driver.freed', { driverId });
  }

  private async awardPoints(stop: CollectionRequest): Promise<void> {
    const request = await this.requestRepo.findOne({
      where: { id: stop.id },
      relations: ['account'],
    });
    if (!request?.account) return;
    const value = Number(request.actualGrandTotal ?? request.estimatedGrandTotal);
    await this.wallet.awardForCollection(
      request.accountId,
      request.account.role,
      value,
      request.requestNumber,
    );
  }

  /** Ships the actual intake to Odoo, one job per delivered stop. */
  private async registerIntake(
    stop: CollectionRequest,
    warehouseOdooId: number | null,
  ): Promise<void> {
    const lines = await this.lineRepo.find({ where: { requestId: stop.id } });
    const estimated = Number(stop.estimatedWeightKg);
    const ratio = estimated > 0 ? Number(stop.actualWeightKg) / estimated : 1;

    const products = await this.productRepo.find({
      where: { id: In(lines.map((l) => l.productId)) },
    });
    const odooIdByProduct = new Map(
      products.map((p) => [p.id, p.odooProductId ?? null]),
    );

    this.odooSync.enqueueRegisterIntake({
      requestId: stop.id,
      odooWarehouseId: warehouseOdooId,
      producerName: stop.contactName ?? null,
      receivedAt: stop.deliveredAt ? stop.deliveredAt.toISOString() : null,
      lines: lines
        .map((line) => ({
          odooProductId: odooIdByProduct.get(line.productId) ?? null,
          quantity: +(Number(line.quantity) * ratio).toFixed(3),
        }))
        .filter((line) => line.odooProductId != null && line.quantity > 0),
    });
  }
}