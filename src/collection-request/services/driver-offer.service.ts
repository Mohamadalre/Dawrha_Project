import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestLine } from '../entities/collection-request-line.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { DispatchEngineService } from './dispatch-engine.service';
import { CollectionRequestAssignmentStatus } from '../enums/collection-request-assignment-status.enum';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import {
  CollectionOfferExpiredException,
  CollectionOfferNotFoundException,
} from '../exceptions/collection-request.exceptions';

interface Caller {
  id: string;
  role: string;
}

/**
 * The driver's side of an offer: accept or reject the single pending offer
 * for a request. The Redis driver key is the fast path; the database is the
 * source of truth — a stale or lost key falls back to the OFFERED row.
 */
@Injectable()
export class DriverOfferService {
  constructor(
    @InjectRepository(CollectorProfile)
    private readonly profileRepo: Repository<CollectorProfile>,
    @InjectRepository(CollectionRequestAssignment)
    private readonly assignmentRepo: Repository<CollectionRequestAssignment>,
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(CollectionRequestLine)
    private readonly lineRepo: Repository<CollectionRequestLine>,
    @InjectRepository(CollectionRoute)
    private readonly routeRepo: Repository<CollectionRoute>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly truckAssignmentRepo: Repository<TruckAssignmentEntity>,
    private readonly engine: DispatchEngineService,
  ) {}

  async accept(caller: Caller, requestId: string) {
    try {
      const assignment = await this.loadPendingOffer(caller.id, requestId);
      if (assignment.offerExpiresAt && assignment.offerExpiresAt.getTime() <= Date.now()) {
        await this.engine.settleOffer(
          assignment,
          CollectionRequestAssignmentStatus.EXPIRED,
        );
        throw new CollectionOfferExpiredException();
      }

      await this.engine.settleOffer(
        assignment,
        CollectionRequestAssignmentStatus.ACCEPTED,
      );
      return this.buildView(assignment.request);
    } catch (error) {
      // Only fall through when there truly was no open offer.
      if (!(error instanceof CollectionOfferNotFoundException)) throw error;
    }

    // The synchronous dispatch path binds the stop without ever creating an
    // open offer — a driver app still calling accept after creation must get
    // his task view, not a 404.
    return this.buildViewIfAlreadyBound(caller.id, requestId);
  }

  async reject(caller: Caller, requestId: string) {
    const assignment = await this.loadPendingOffer(caller.id, requestId);
    await this.engine.settleOffer(
      assignment,
      CollectionRequestAssignmentStatus.REJECTED,
    );
    return { request_id: requestId, status: 'REJECTED' };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async loadPendingOffer(
    accountId: string,
    requestId: string,
  ): Promise<CollectionRequestAssignment> {
    const profile = await this.profileRepo.findOne({
      where: { account: { id: accountId } },
    });
    if (!profile) throw new CollectionOfferNotFoundException();

    const assignment = await this.assignmentRepo.findOne({
      where: {
        requestId,
        driverId: profile.id,
        status: CollectionRequestAssignmentStatus.OFFERED,
      },
      relations: ['request'],
    });
    if (!assignment) throw new CollectionOfferNotFoundException();
    return assignment;
  }

  /**
   * The stop is already on this driver's tour (sync dispatch or a merge) —
   * serve it as if he had just accepted. Anything still unbound (QUEUED/
   * CREATED) or bound to someone else stays a clean not-found.
   */
  private async buildViewIfAlreadyBound(accountId: string, requestId: string) {
    const profile = await this.profileRepo.findOne({
      where: { account: { id: accountId } },
    });
    if (!profile) throw new CollectionOfferNotFoundException();

    const request = await this.requestRepo
      .createQueryBuilder('r')
      .innerJoin('r.route', 'route')
      .where('r.id = :id', { id: requestId })
      .andWhere('route.driverId = :driverId', { driverId: profile.id })
      .getOne();

    const bound =
      request &&
      request.status !== CollectionRequestStatus.QUEUED &&
      request.status !== CollectionRequestStatus.CREATED;
    if (!bound) throw new CollectionOfferNotFoundException();

    return this.buildView(request);
  }

  private async buildView(request: CollectionRequest | null) {
    if (!request) {
      return {
        request_id: null,
        request_number: null,
        status: null,
        route_id: null,
        route_sequence: null,
        lines: [],
        truck_capacity: null,
      };
    }

    const lines = await this.lineRepo.find({ where: { requestId: request.id } });
    const truckCapacity = await this.getTruckCapacity(request);

    return {
      request_id: request.id,
      request_number: request.requestNumber,
      status: request.status,
      route_id: request.routeId,
      route_sequence: request.routeSequence,
      lines: lines.map((l) => ({
        product_id: l.productId,
        product_name: l.productName,
        unit_type: l.unitType,
        quantity: Number(l.quantity),
        note: l.note ?? null,
      })),
      truck_capacity: truckCapacity,
    };
  }

  private async getTruckCapacity(
    request: CollectionRequest,
  ): Promise<{ max_kg: number; used_kg: number; remaining_kg: number; is_full: boolean } | null> {
    if (!request.routeId) return null;

    const route = await this.routeRepo.findOne({
      where: { id: request.routeId },
      relations: ['requests'],
    });
    if (!route) return null;

    const assignment = await this.truckAssignmentRepo.findOne({
      where: { driverId: route.driverId },
      relations: ['truck'],
    });
    if (!assignment?.truck?.maxPayloadKg) return null;

    const maxKg = Number(assignment.truck.maxPayloadKg);

    const usedKg = (route.requests ?? []).reduce((sum, r) => {
      const w = r.actualWeightKg ? Number(r.actualWeightKg) : Number(r.estimatedWeightKg || 0);
      return sum + w;
    }, 0);

    const remaining = Math.max(0, maxKg - usedKg);
    return {
      max_kg: maxKg,
      used_kg: +usedKg.toFixed(2),
      remaining_kg: +remaining.toFixed(2),
      is_full: remaining <= 0,
    };
  }
}