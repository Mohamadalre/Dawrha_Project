import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import { ShipmentService } from './shipment.service';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import {
  CollectionRequestNotFoundException,
  CollectionRequestInvalidTransitionException,
  CollectionDriverNotEligibleException,
} from '../exceptions/collection-request.exceptions';
import { CollectionRoute } from '../entities/collection-route.entity';
import { CollectionStateService } from '../providers/collection-state.service';
import { DispatchConfigProvider } from '../providers/dispatch-config.provider';
import {
  DispatchCandidatesService,
  DriverCandidate,
} from './dispatch-candidates.service';
import { DispatchGatewayEvents } from '../gateways/dispatch.gateway';
import { DispatchConfig } from '../entities/dispatch-config.entity';
import {
  CollectionRequestStatus,
} from '../enums/collection-request-status.enum';
import {
  CollectionRequestAssignmentStatus,
} from '../enums/collection-request-assignment-status.enum';
import { CollectionRouteStatus } from '../enums/collection-route-status.enum';
import { CollectionRequestType } from '../enums/collection-request-type.enum';
import {
  COLLECTION_DISPATCH_QUEUE,
  DISPATCH_JOB,
  DISPATCH_REDIS,
} from '../constants/dispatch.constants';
import { nextSequentialNumber } from '../utils/sequence.util';
import { haversineKm, headingDiffDeg, bearingBetween } from '../utils/geo.util';
import { canMergeInto, RouteStop } from '../providers/route-planner';

const LOG_META = { context: 'DISPATCH_ENGINE', channel: 'collection' } as const;

/** A live truck fix as stored by the tracking gateway, minimal shape. */
interface LiveLocation {
  lat: number;
  lng: number;
  heading?: number | null;
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/**
 * The dispatch engine: elects a driver for a queued request, settles offers,
 * and reacts to everything that should start or move an election.
 *
 * Election = hard-filtered candidates (DispatchCandidatesService) x the six
 * weighted factors from the singleton dispatch_config. Only ONE offer is ever
 * outstanding per request — the winner is offered, and the next candidate is
 * elected only when that offer is rejected, lapses, or is withdrawn.
 *
 * Triggers (all routed through the collection-dispatch BullMQ queue so nothing
 * is lost when the API restarts):
 *  1. a request entered the queue            -> ELECT
 *  2. a scheduled/plan request's window opened (delayed job) -> OPEN_WINDOW
 *  3. an offer was settled (driver freed)    -> ELECT (next candidate)
 *  4. a driver's truck moved (throttled)     -> ELECT_NEXT_FOR_DRIVER
 */
@Injectable()
export class DispatchEngineService {
  private readonly logger = new Logger('DISPATCH_ENGINE');

  constructor(
    @InjectQueue(COLLECTION_DISPATCH_QUEUE) private readonly queue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(CollectionRequestAssignment)
    private readonly assignmentRepo: Repository<CollectionRequestAssignment>,
    @InjectRepository(CollectionRoute)
    private readonly routeRepo: Repository<CollectionRoute>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly truckAssignmentRepo: Repository<TruckAssignmentEntity>,
    @InjectRepository(CollectorProfile)
    private readonly profileRepo: Repository<CollectorProfile>,
    private readonly state: CollectionStateService,
    private readonly configProvider: DispatchConfigProvider,
    private readonly candidates: DispatchCandidatesService,
    private readonly events: DispatchGatewayEvents,
    private readonly notifications: NotificationService,
    private readonly shipmentService: ShipmentService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Full election for one request. Safe to call any time; races are checked. */
  async elect(requestId: string): Promise<void> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request || request.status !== CollectionRequestStatus.QUEUED) return;

    const config = await this.configProvider.get();
    if (!config.isEnabled) return;

    // Scheduled/plan requests only enter the queue when their lead-time window
    // opens; this guards a race where someone requeues one early (admin
    // override) — the pickup slot must still be honoured.
    if (
      request.type !== CollectionRequestType.IMMEDIATE &&
      request.scheduledAt &&
      request.scheduledAt.getTime() - Date.now() > config.scheduledLeadMin * 60_000
    ) {
      return;
    }

    // One outstanding offer at a time: a settled request must never be offered
    // twice in parallel.
    const outstanding = await this.assignmentRepo.count({
      where: { requestId, status: CollectionRequestAssignmentStatus.OFFERED },
    });
    if (outstanding > 0) return;

    // A moving driver who can absorb this request into his tour wins WITHOUT an
    // election — merging is the priority rule from the design, and only falls
    // back to scoring when no route can take it.
    if (await this.tryMergeRequest(request, config)) return;

    const pool = await this.candidates.findEligible(request, config);
    if (!pool.length) {
      await this.needsAdmin(request, 'No eligible driver could be found');
      return;
    }

    const locations = await this.loadLocations(pool);
    const ranked = pool
      .map((candidate) => ({
        candidate,
        score: this.score(candidate, request, config, locations.get(candidate.truckId)),
      }))
      .sort((a, b) => b.score - a.score);

    await this.offer(ranked[0].candidate, ranked[0].score, request, config);
    winstonLogger.info(
      `Collection request ${request.requestNumber}: offering to ${ranked[0].candidate.driverId} (score ${ranked[0].score.toFixed(2)})`,
      LOG_META,
    );
  }

  /** The driver-freed / location trigger: elect the oldest still-unserved request. */
  async electNextForDriver(): Promise<void> {
    const request = await this.requestRepo.findOne({
      where: { status: CollectionRequestStatus.QUEUED },
      order: { createdAt: 'ASC' },
    });
    if (request) await this.elect(request.id);
  }

  /**
   * Synchronous election: picks the best available driver immediately without
   * creating an offer or going through BullMQ. Used by the synchronous dispatch
   * flow in collection-request.service where the driver is pre-assigned at
   * creation time. Returns null when no eligible driver is found.
   *
   * When a merge into an active route succeeds (tryMergeRequest returns true),
   * the request is already bound — the caller does NOT need to call settleOffer;
   * instead it returns `{ merged: true, driverId }` so the caller can load the
   * profile directly.
   */
  async electSynchronous(
    request: CollectionRequest,
  ): Promise<{ candidate: DriverCandidate; score: number } | { merged: true; driverId: string } | null> {
    const config = await this.configProvider.get();
    if (!config.isEnabled) return null;

    if (await this.tryMergeRequest(request, config)) {
      const route = await this.routeRepo.findOne({
        where: { id: request.routeId },
      });
      return route ? { merged: true, driverId: route.driverId } : null;
    }

    const pool = await this.candidates.findEligible(request, config);
    if (!pool.length) return null;

    const locations = await this.loadLocations(pool);
    const ranked = pool
      .map((candidate) => ({
        candidate,
        score: this.score(candidate, request, config, locations.get(candidate.truckId)),
      }))
      .sort((a, b) => b.score - a.score);

    return { candidate: ranked[0].candidate, score: ranked[0].score };
  }

  /**
   * Loads the full driver profile for a candidate, including name, phone,
   * truck details, and shift window. Returns a plain object suitable for
   * the API response.
   */
  async loadCandidateProfile(candidate: DriverCandidate) {
    const profileRepo = this.requestRepo.manager.getRepository('CollectorProfile');
    const profile = await profileRepo.findOne({
      where: { id: candidate.driverId },
      relations: ['account', 'assignment', 'assignment.truck', 'shift'],
    });
    if (!profile) return null;

    return {
      driver_id: profile.id,
      account_id: candidate.accountId,
      name: profile.account?.name ?? null,
      phone: profile.account?.phone ?? null,
      truck: profile.assignment?.truck
        ? {
            id: profile.assignment.truck.id,
            plate_number: profile.assignment.truck.plateNumber,
            model: profile.assignment.truck.model,
            max_payload_kg: Number(profile.assignment.truck.maxPayloadKg),
          }
        : null,
      shift: profile.shift
        ? {
            start: profile.shift.startTime,
            end: profile.shift.endTime,
          }
        : null,
      active_tasks: candidate.activeTasks,
      completed_today: candidate.completedToday,
      score: null as number | null,
    };
  }

  /**
   * The merge rule (design §5): a request near a driver whose tour is already
   * running joins that tour directly — no election, no offer. The RoutePlanner
   * decides position and feasibility (≤ mergeMaxMin / mergeMaxKm, and no
   * institution stop pushed past its ±tolerance window); the candidate filter
   * still guards the driver's eligibility and payload capacity.
   */
  async tryMergeRequest(
    request: CollectionRequest,
    config: DispatchConfig,
  ): Promise<boolean> {
    if (request.lat == null || request.lng == null) return false;

    const routes = await this.routeRepo.find({
      where: { status: CollectionRouteStatus.IN_PROGRESS },
      relations: ['requests'],
    });
    const now = new Date();
    const constraints = {
      mergeMaxMinutes: config.routeMergeMaxMin,
      mergeMaxKm: Number(config.routeMergeMaxKm) || 5,
      institutionToleranceMin: config.institutionToleranceMin,
    };

    for (const route of routes) {
      const stops = (route.requests ?? [])
        .slice()
        .sort((a, b) => (a.routeSequence ?? Infinity) - (b.routeSequence ?? Infinity));

      const open = stops.filter((s) =>
        [
          CollectionRequestStatus.ASSIGNED,
          CollectionRequestStatus.EN_ROUTE,
          CollectionRequestStatus.ARRIVED,
          CollectionRequestStatus.PICKING,
        ].includes(s.status),
      );
      // A route almost finished is a route that may close before the request
      // even reaches the driver — requiring at least one open stop after the
      // inserted one keeps the merge honest.
      if (open.length < 1) continue;

      const done = [...stops]
        .reverse()
        .find((s) =>
          [
            CollectionRequestStatus.DELIVERED,
            CollectionRequestStatus.COMPLETED,
            CollectionRequestStatus.CANCELLED,
          ].includes(s.status),
        );
      if (open.some((s) => s.lat == null || s.lng == null)) continue;

      // Mid-round there is no served stop yet — anchor the merge at the
      // driver's live truck fix instead, so a nearby request can still join
      // the running tour (and its shipment) while he works.
      const anchor =
        done != null
          ? this.wrapStop(done)
          : await this.liveAnchor(route.driverId);

      const verdict = canMergeInto({
        stops: open.map((s) => this.wrapStop(s)),
        lastServed: anchor,
        incoming: this.wrapStop(request),
        now,
        constraints,
      });
      if (!verdict.mergeable || verdict.position == null) continue;

      // The merge target must still be an eligible, capable driver.
      const eligible = await this.candidates.findEligible(request, config, [
        route.driverId,
      ], { allowBusy: true });
      if (!eligible.length) continue;

      await this.bindMerged(
        route,
        stops,
        open,
        request,
        verdict.position,
        eligible[0].accountId,
      );
      return true;
    }
    return false;
  }

  /** A scheduled/plan request's wait is over — open the queue window. */
  async openWindow(requestId: string): Promise<void> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request || request.status !== CollectionRequestStatus.CREATED) return;

    this.state.applyRequestStatus(request, CollectionRequestStatus.QUEUED);
    await this.requestRepo.save(request);
    await this.enqueueElect(request.id);
    winstonLogger.info(
      `Collection request ${request.requestNumber}: queue window opened`,
      LOG_META,
    );
  }

  /** Schedules the OPEN_WINDOW job `scheduled_lead_min` before pickup time. */
  async scheduleWindow(request: CollectionRequest): Promise<void> {
    if (!request.scheduledAt || request.status !== CollectionRequestStatus.CREATED) {
      return;
    }
    const config = await this.configProvider.get();
    const delay =
      request.scheduledAt.getTime() - Date.now() - config.scheduledLeadMin * 60_000;
    if (delay <= 0) {
      await this.openWindow(request.id);
      return;
    }
    await this.queue.add(
      DISPATCH_JOB.OPEN_WINDOW,
      { requestId: request.id },
      { delay, jobId: `open-window:${request.id}` },
    );
  }

  /**
   * The admin override (design §14): hand a request stuck in the queue to a
   * SPECIFIC driver. The ledger still records the OFFERED→ACCEPTED pair — every
   * assignment stays replayable — and the request then binds to his route
   * exactly like an accepted offer. The candidate filters still apply: an
   * ineligible or busy driver cannot be force-assigned, and a NEEDS_ADMIN
   * request is first requeued so the binding transition is legal.
   */
  async assignManually(requestId: string, driverId: string): Promise<void> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new CollectionRequestNotFoundException();
    if (
      request.status !== CollectionRequestStatus.QUEUED &&
      request.status !== CollectionRequestStatus.NEEDS_ADMIN
    ) {
      throw new CollectionRequestInvalidTransitionException('This request cannot be assigned manually');
    }

    const config = await this.configProvider.get();
    const candidates = await this.candidates.findEligible(request, config, [driverId], { allowBusy: true });
    if (!candidates.length) throw new CollectionDriverNotEligibleException();

    if (request.status === CollectionRequestStatus.NEEDS_ADMIN) {
      this.state.applyRequestStatus(request, CollectionRequestStatus.QUEUED);
      await this.requestRepo.save(request);
    }

    const assignment = this.assignmentRepo.create({
      request,
      requestId: request.id,
      driverId,
      status: CollectionRequestAssignmentStatus.OFFERED,
      score: null,
      offerExpiresAt: null,
    });
    await this.assignmentRepo.save(assignment);
    await this.settleOffer(assignment, CollectionRequestAssignmentStatus.ACCEPTED);
  }

  /**
   * Settles an outstanding offer. ACCEPTED binds the request to the driver
   * (route slot + ASSIGNED); REJECTED/EXPIRED move to the next candidate.
   */
  async settleOffer(
    assignment: CollectionRequestAssignment,
    to: CollectionRequestAssignmentStatus,
  ): Promise<void> {
    if (assignment.status !== CollectionRequestAssignmentStatus.OFFERED) return;

    this.state.applyAssignmentStatus(assignment, to);
    await this.assignmentRepo.save(assignment);
    await this.clearOfferKeys(assignment);

    const request = assignment.request;
    if (to === CollectionRequestAssignmentStatus.ACCEPTED) {
      if (!request || request.status !== CollectionRequestStatus.QUEUED) return;
      await this.bindToRoute(request, assignment.driverId);

      // Auto-create or add to active shipment
      await this.shipmentService.autoCreateOrAddToShipment(
        assignment.driverId,
        request,
      );

      // Track truck→request mapping for live GPS forwarding to users.
      await this.trackRequestForDriver(request.id, assignment.driverId);

      this.events.announceToRequest(
        request.id,
        'request:status',
        this.statusPayload(request),
      );
      await this.notifyProducerAssigned(request);
      // The synchronous path has no OFFERED step, so the driver would never
      // learn about the task until he opens his route list — tell him now.
      await this.notifyDriverAssigned(assignment.driverId, request);
      winstonLogger.info(
        `Collection request ${request.requestNumber}: assigned to driver ${assignment.driverId}`,
        LOG_META,
      );
      return;
    }

    // Rejected / expired: if the request is still in the queue, elect again.
    if (request && request.status === CollectionRequestStatus.QUEUED) {
      await this.enqueueElect(request.id);
    } else {
      this.logger.log(
        `Offer for request ${assignment.requestId} settled (${to}) but request is no longer queued`,
      );
    }
  }

  /** Reacts to a producer cancelling: clean every Redis key + tell the room. */
  async onRequestCancelled(request: CollectionRequest): Promise<void> {
    const assignments = await this.assignmentRepo.find({
      where: { requestId: request.id },
    });
    for (const assignment of assignments) {
      await this.clearOfferKeys(assignment);
    }
    await this.untrackRequest(request.id);
    this.events.announceToRequest(
      request.id,
      'request:status',
      this.statusPayload(request),
    );
  }

  // ---------------------------------------------------------------------------
  // Event wiring (the four triggers)
  // ---------------------------------------------------------------------------
  @OnEvent('collection.request.queued')
  async handleQueued(payload: { requestId: string }): Promise<void> {
    try {
      const request = await this.requestRepo.findOne({
        where: { id: payload.requestId },
      });
      if (!request) return;

      // Immediate requests are already QUEUED (the create flow) and need an
      // election; scheduled/plan requests are still CREATED and only need the
      // window job that will queue them at lead time.
      if (request.type === CollectionRequestType.IMMEDIATE) {
        if (request.status !== CollectionRequestStatus.QUEUED) return;
        await this.enqueueElect(request.id);
      } else {
        await this.scheduleWindow(request);
      }
    } catch (error) {
      this.logger.error('handleQueued failed', error as Error);
    }
  }

  @OnEvent('collection.request.cancelled')
  async handleCancelled(payload: { requestId: string }): Promise<void> {
    try {
      const request = await this.requestRepo.findOne({
        where: { id: payload.requestId },
      });
      if (request) await this.onRequestCancelled(request);
    } catch (error) {
      this.logger.error('handleCancelled failed', error as Error);
    }
  }

  @OnEvent('collection.driver.freed')
  async handleDriverFreed(): Promise<void> {
    try {
      await this.electNextForDriver();
    } catch (error) {
      this.logger.error('handleDriverFreed failed', error as Error);
    }
  }

  @OnEvent('truck.location.updated')
  async handleLocationUpdated(payload: {
    truckId?: string;
    driverId?: string | null;
    lat?: number;
    lng?: number;
    heading?: number | null;
  }): Promise<void> {
    try {
      // Throttled per driver: a moving truck must not trigger an election per
      // GPS ping, but one every ~minute keeps fresh positions in the scores.
      if (!payload.driverId) return;
      const throttled = await this.redis.set(
        DISPATCH_REDIS.locationThrottleKey(payload.driverId),
        '1',
        'EX',
        60,
        'NX',
      );
      if (throttled) {
        await this.queue.add(
          DISPATCH_JOB.ELECT_NEXT_FOR_DRIVER,
          { driverId: payload.driverId },
          { removeOnComplete: true, removeOnFail: { count: 100 } },
        );
      }
    } catch (error) {
      this.logger.error('handleLocationUpdated failed', error as Error);
    }
  }

  // ---------------------------------------------------------------------------
  // Scoring (the six factors, each 0..100, weighted by dispatch_config)
  // ---------------------------------------------------------------------------
  private score(
    candidate: DriverCandidate,
    request: CollectionRequest,
    config: DispatchConfig,
    location: LiveLocation | null,
  ): number {
    const w = config.weights;

    const proximity = this.scoreProximity(candidate, request, location);
    const direction = this.scoreDirection(request, location);
    const load = clamp(100 - candidate.activeTasks * 22, 0, 100);
    const vehicle =
      candidate.maxPayloadKg != null && candidate.maxPayloadKg > 0
        ? clamp(
            ((candidate.maxPayloadKg - candidate.activeWeightKg) /
              candidate.maxPayloadKg) *
              100,
            0,
            100,
          )
        : 100;

    const deadline =
      request.type === CollectionRequestType.IMMEDIATE || !request.scheduledAt
        ? 100
        : this.scoreDeadline(request.scheduledAt);

    const fairness = clamp(100 - (candidate.completedToday - 1) * 12, 0, 100);

    return (
      (proximity * w.proximity +
        direction * w.direction +
        load * w.load +
        vehicle * w.vehicle +
        deadline * w.deadline +
        fairness * w.fairness) /
      100
    );
  }

  /** Linear decay with distance. No fix on either side -> neutral 50. */
  private scoreProximity(
    candidate: DriverCandidate,
    request: CollectionRequest,
    location: LiveLocation | null,
  ): number {
    const from = location ?? candidate.fallbackLocation;
    if (!from || request.lat == null || request.lng == null) return 50;

    const distanceKm = haversineKm(
      from.lat,
      from.lng,
      Number(request.lat),
      Number(request.lng),
    );
    return clamp(100 - distanceKm * 10, 0, 100);
  }

  /** Heading alignment with the bearing to the pickup; no heading -> neutral 50. */
  private scoreDirection(
    request: CollectionRequest,
    location: LiveLocation | null,
  ): number {
    if (!location?.heading || request.lat == null || request.lng == null) return 50;
    const bearing = bearingBetween(
      location.lat,
      location.lng,
      Number(request.lat),
      Number(request.lng),
    );
    if (bearing == null) return 50;
    return (1 - headingDiffDeg(location.heading, bearing) / 180) * 100;
  }

  /** Urgency: every minute of slack before the pickup is worth 2.5 points. */
  private scoreDeadline(scheduledAt: Date): number {
    const minutes = (scheduledAt.getTime() - Date.now()) / 60_000;
    return clamp(minutes * 2.5, 0, 100);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async offer(
    candidate: DriverCandidate,
    score: number,
    request: CollectionRequest,
    config: DispatchConfig,
  ): Promise<void> {
    const expiresAt = new Date(
      Date.now() + config.acceptWindowSec * 1000,
    );
    const assignment = this.assignmentRepo.create({
      requestId: request.id,
      driverId: candidate.driverId,
      status: CollectionRequestAssignmentStatus.OFFERED,
      score: String(+score.toFixed(2)),
      offerExpiresAt: expiresAt,
    });
    const saved = await this.assignmentRepo.save(assignment);

    // Accept-window keys: the driver fast-path plus a per-offer TTL marker.
    await this.redis
      .multi()
      .set(DISPATCH_REDIS.offerKey(saved.id), '1', 'EX', config.acceptWindowSec)
      .set(
        DISPATCH_REDIS.driverOfferKey(candidate.driverId),
        saved.id,
        'EX',
        config.acceptWindowSec,
      )
      .exec();

    this.events.announceToDriver(
      candidate.accountId,
      'request:assigned',
      this.offerPayload(request, saved, score, config),
    );
    await this.notifyDriverOffered(candidate.accountId, request, config);
  }

  private async needsAdmin(request: CollectionRequest, reason: string): Promise<void> {
    if (request.status !== CollectionRequestStatus.QUEUED) return;
    this.state.applyRequestStatus(request, CollectionRequestStatus.NEEDS_ADMIN);
    await this.requestRepo.save(request);
    this.events.announceToAdmins('request:needs_admin', {
      request_id: request.id,
      request_number: request.requestNumber,
      reason,
    });
    winstonLogger.warn(
      `Collection request ${request.requestNumber}: ${reason} — NEEDS_ADMIN`,
      LOG_META,
    );
  }

  private async bindMerged(
    route: CollectionRoute,
    stops: CollectionRequest[],
    open: CollectionRequest[],
    request: CollectionRequest,
    position: number,
    driverAccountId: string,
  ): Promise<void> {
    // The planner's position is relative to the OPEN stops; map it into the
    // full tour (the done stops keep their numbers).
    const firstOpenIndex = stops.findIndex((s) => open.some((o) => o.id === s.id));
    const fullIndex = firstOpenIndex === -1 ? stops.length : firstOpenIndex + position;
    const all = [...stops];
    all.splice(fullIndex, 0, request);

    const changed = all
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => s.routeSequence !== i + 1)
      .map(({ s, i }) => ({ ...s, routeSequence: i + 1 }));
    if (changed.length) {
      await this.requestRepo.save(changed);
    }
    request.routeId = route.id;
    request.routeSequence = fullIndex + 1;
    this.state.applyRequestStatus(request, CollectionRequestStatus.ASSIGNED);
    await this.requestRepo.save(request);
    this.eventEmitter.emit('collection.request.assigned', {
      driverId: route.driverId,
      requestId: request.id,
    });

    // The driver's app learns about the merged stop directly; the producer
    // gets the usual assignment push.
    this.events.announceToDriver(driverAccountId, 'request:assigned', {
      event: 'MERGED',
      request_id: request.id,
      request_number: request.requestNumber,
      type: request.type,
      scheduled_at: request.scheduledAt ?? null,
      address_text: request.addressText,
      lat: request.lat != null ? Number(request.lat) : null,
      lng: request.lng != null ? Number(request.lng) : null,
      estimated_weight_kg: Number(request.estimatedWeightKg),
      route_id: route.id,
      route_sequence: request.routeSequence,
    });
    await this.notifyProducerAssigned(request);

    // Auto-add merged request to the driver's active shipment
    await this.shipmentService.autoCreateOrAddToShipment(
      route.driverId,
      request,
    );

    // Track truck→request for live GPS forwarding to user.
    await this.trackRequestForDriver(request.id, route.driverId);

    winstonLogger.info(
      `Collection request ${request.requestNumber}: merged into route ${route.routeNumber} of ${route.driverId} (stop ${fullIndex + 1})`,
      LOG_META,
    );
  }

  private wrapStop(request: CollectionRequest): RouteStop {
    return {
      requestId: request.id,
      lat: Number(request.lat),
      lng: Number(request.lng),
      scheduledAt: request.scheduledAt ?? null,
    };
  }

  /**
   * The driver's live truck fix as a merge anchor, for tours that have not
   * served a stop yet. Null when the driver has no assignment or no fresh
   * position — the merge then honestly refuses rather than guessing.
   */
  private async liveAnchor(driverId: string): Promise<RouteStop | null> {
    try {
      const assignment = await this.truckAssignmentRepo.findOne({
        where: { driverId },
        select: ['truckId'],
      });
      if (!assignment?.truckId) return null;

      const raw = await this.redis.get(
        `truck:location:${assignment.truckId}`,
      );
      if (!raw) return null;
      const fix = JSON.parse(raw) as LiveLocation;
      if (fix.lat == null || fix.lng == null) return null;

      return {
        requestId: '__live_anchor__',
        lat: Number(fix.lat),
        lng: Number(fix.lng),
        scheduledAt: null,
      };
    } catch {
      // A corrupt frame or a tracking hiccup must not sink the election.
      return null;
    }
  }

  /** Binds an accepted request to the driver's open route (or creates one). */
  private async bindToRoute(
    request: CollectionRequest,
    driverId: string,
  ): Promise<void> {
    // Same definition of "the driver's current tour" that loadStop uses —
    // oldest PLANNED *or* IN_PROGRESS. Binding to a PLANNED-only route while
    // an older IN_PROGRESS one exists would strand the stop off his active
    // tour ("stop not on your active tour").
    let route = await this.routeRepo.findOne({
      where: {
        driverId,
        status: In([CollectionRouteStatus.PLANNED, CollectionRouteStatus.IN_PROGRESS]),
      },
      order: { createdAt: 'ASC' },
    });
    if (!route) {
      route = this.routeRepo.create({
        routeNumber: await nextSequentialNumber(
          this.routeRepo,
          'routeNumber',
          this.routePrefix(),
          3,
        ),
        driverId,
        status: CollectionRouteStatus.PLANNED,
      });
      route = await this.routeRepo.save(route);
    }

    const maxSeq = await this.requestRepo.maximum('routeSequence', {
      routeId: route.id,
    });
    request.routeId = route.id;
    request.routeSequence = (maxSeq ?? 0) + 1;
    this.state.applyRequestStatus(request, CollectionRequestStatus.ASSIGNED);
    await this.requestRepo.save(request);
    this.eventEmitter.emit('collection.request.assigned', {
      driverId,
      requestId: request.id,
    });
  }

  private async loadLocations(candidates: DriverCandidate[]): Promise<Map<string, LiveLocation>> {
    const truckIds = candidates.map((c) => c.truckId);
    const values = await this.redis.mget(truckIds.map((id) => `truck:location:${id}`));
    const map = new Map<string, LiveLocation>();
    truckIds.forEach((id, i) => {
      const raw = values[i];
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as LiveLocation;
        if (parsed.lat != null && parsed.lng != null) map.set(id, parsed);
      } catch {
        // A corrupt frame must not sink the election — ignore it.
      }
    });
    return map;
  }

  private async clearOfferKeys(assignment: CollectionRequestAssignment): Promise<void> {
    await this.redis
      .multi()
      .del(DISPATCH_REDIS.offerKey(assignment.id))
      .del(DISPATCH_REDIS.driverOfferKey(assignment.driverId))
      .exec();
  }

  // ---------------------------------------------------------------------------
  // Truck → request tracking (for live GPS forwarding to users)
  // ---------------------------------------------------------------------------
  async trackRequestForDriver(requestId: string, driverId: string): Promise<void> {
    try {
      const assignment = await this.truckAssignmentRepo.findOne({
        where: { driverId },
        select: ['truckId'],
      });
      if (!assignment) return;

      const truckKey = DISPATCH_REDIS.truckRequestsKey(assignment.truckId);
      const mapKey = DISPATCH_REDIS.requestTruckKey();
      await this.redis
        .multi()
        .sadd(truckKey, requestId)
        .hset(mapKey, requestId, assignment.truckId)
        .exec();
    } catch (err) {
      this.logger.warn('trackRequestForDriver failed', err as Error);
    }
  }

  async untrackRequest(requestId: string): Promise<void> {
    try {
      const mapKey = DISPATCH_REDIS.requestTruckKey();
      const truckId = await this.redis.hget(mapKey, requestId);
      if (!truckId) return;

      const truckKey = DISPATCH_REDIS.truckRequestsKey(truckId);
      await this.redis
        .multi()
        .srem(truckKey, requestId)
        .hdel(mapKey, requestId)
        .exec();
    } catch (err) {
      this.logger.warn('untrackRequest failed', err as Error);
    }
  }

  private async enqueueElect(requestId: string): Promise<void> {
    await this.queue.add(
      DISPATCH_JOB.ELECT,
      { requestId },
      { removeOnComplete: true, removeOnFail: { count: 100 } },
    );
  }

  private async notifyDriverOffered(
    accountId: string,
    request: CollectionRequest,
    config: DispatchConfig,
  ): Promise<void> {
    const minutes = Math.max(1, Math.round(config.acceptWindowSec / 60));
    await this.tryNotify(
      accountId,
      'طلب جمع جديد',
      `لديك طلب جمع جديد (${request.requestNumber}). ${minutes} دقائق للقبول من تطبيق السائق.`,
      request,
    );
  }

  private async notifyProducerAssigned(request: CollectionRequest): Promise<void> {
    await this.tryNotify(
      request.accountId,
      'تم إسناد طلبك',
      `تم تعيين سائق لطلب الجمع رقم ${request.requestNumber}.`,
      request,
    );
  }

  /**
   * Tells the driver his tour gained a stop: a socket push to his room plus a
   * notification. Covers the synchronous dispatch and the admin override —
   * both settle ACCEPTED without ever creating an open offer.
   */
  private async notifyDriverAssigned(
    driverId: string,
    request: CollectionRequest,
  ): Promise<void> {
    try {
      const profile = await this.profileRepo.findOne({
        where: { id: driverId },
        relations: ['account'],
      });
      const accountId = profile?.account?.id;
      if (!accountId) return;

      this.events.announceToDriver(accountId, 'request:assigned', {
        event: 'ASSIGNED',
        request_id: request.id,
        request_number: request.requestNumber,
        type: request.type,
        scheduled_at: request.scheduledAt ?? null,
        address_text: request.addressText,
        lat: request.lat != null ? Number(request.lat) : null,
        lng: request.lng != null ? Number(request.lng) : null,
        estimated_weight_kg: Number(request.estimatedWeightKg),
        estimated_grand_total: Number(request.estimatedGrandTotal),
        route_id: request.routeId ?? null,
        route_sequence: request.routeSequence ?? null,
      });
      await this.tryNotify(
        accountId,
        'تم إسناد طلب جمع جديد لك',
        `تم تعيين طلب الجمع ${request.requestNumber} عليك — تفقد جولتك في تطبيق السائق.`,
        request,
      );
    } catch (error) {
      // A driver-facing push must never break the binding.
      this.logger.warn('notifyDriverAssigned failed', error as Error);
    }
  }

  private async tryNotify(
    accountId: string,
    title: string,
    body: string,
    request: CollectionRequest,
  ): Promise<void> {
    try {
      const notification = await this.notifications.createNotification({
        userId: accountId,
        title,
        body,
        type: NotificationType.RECYCLING_REQUEST,
        metadata: { requestId: request.id, requestNumber: request.requestNumber },
      });
      await this.notifications.enqueueNotification(notification.id);
    } catch (error) {
      // A push must never break an election.
      this.logger.warn(`Failed to notify ${accountId}`, error as Error);
    }
  }

  private offerPayload(
    request: CollectionRequest,
    assignment: CollectionRequestAssignment,
    score: number,
    config: DispatchConfig,
  ) {
    return {
      event: 'OFFERED',
      request_id: request.id,
      request_number: request.requestNumber,
      type: request.type,
      scheduled_at: request.scheduledAt ?? null,
      address_text: request.addressText,
      lat: request.lat != null ? Number(request.lat) : null,
      lng: request.lng != null ? Number(request.lng) : null,
      estimated_weight_kg: Number(request.estimatedWeightKg),
      estimated_grand_total: Number(request.estimatedGrandTotal),
      offer_id: assignment.id,
      score: +score.toFixed(2),
      offer_expires_at: assignment.offerExpiresAt,
      accept_window_sec: config.acceptWindowSec,
    };
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

  private routePrefix(): string {
    const now = new Date();
    return `RTE-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }
}