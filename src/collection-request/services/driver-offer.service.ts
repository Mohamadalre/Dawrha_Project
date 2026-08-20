import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import { DispatchEngineService } from './dispatch-engine.service';
import { CollectionRequestAssignmentStatus } from '../enums/collection-request-assignment-status.enum';
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
    private readonly engine: DispatchEngineService,
  ) {}

  async accept(caller: Caller, requestId: string) {
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

  private buildView(request: CollectionRequest | null) {
    return {
      request_id: request?.id ?? null,
      request_number: request?.requestNumber ?? null,
      status: request?.status ?? null,
      route_id: request?.routeId ?? null,
      route_sequence: request?.routeSequence ?? null,
    };
  }
}