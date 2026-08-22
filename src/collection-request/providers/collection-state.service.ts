import { ConflictException, Injectable } from '@nestjs/common';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import {
  canTransitionRequest,
  CollectionRequestStatus,
} from '../enums/collection-request-status.enum';
import {
  canTransitionAssignment,
  CollectionRequestAssignmentStatus,
} from '../enums/collection-request-assignment-status.enum';
import {
  canTransitionRoute,
  CollectionRouteStatus,
} from '../enums/collection-route-status.enum';

const LOG_META = { context: 'COLLECTION_STATE', channel: 'collection' } as const;

/**
 * The only place a collection request, route or assignment changes status.
 *
 * Routing every move through one guard means an illegal transition is caught
 * where it happens rather than surfacing later as a nonsensical state — a
 * request that is somehow both DELIVERED and QUEUED, say. The legal moves
 * themselves live in the transition maps, so this file holds no lifecycle
 * knowledge of its own and never needs editing when a state is added.
 */
@Injectable()
export class CollectionStateService {
  /**
   * Moves the request, or refuses with a message that names both states.
   *
   * 409 rather than 400: the request was well-formed, the request simply is
   * not where the caller believed. That is exactly what happens when a
   * producer taps "cancel" at the instant the driver starts PICKING — and the
   * loser of that race deserves to be told which it was.
   */
  assertRequestTransition(request: CollectionRequest, to: CollectionRequestStatus): void {
    if (request.status === to) return;
    if (!canTransitionRequest(request.status, to)) {
      throw new ConflictException(
        `Collection request ${request.requestNumber} cannot move from ${request.status} to ${to}`,
      );
    }
  }

  applyRequestStatus(
    request: CollectionRequest,
    to: CollectionRequestStatus,
    at = new Date(),
  ): CollectionRequest {
    this.assertRequestTransition(request, to);
    if (request.status === to) return request;

    const from = request.status;
    request.status = to;
    this.stampRequest(request, to, at);
    winstonLogger.info(
      `Collection request ${request.requestNumber}: ${from} -> ${to}`,
      LOG_META,
    );
    return request;
  }

  assertRouteTransition(route: CollectionRoute, to: CollectionRouteStatus): void {
    if (route.status === to) return;
    if (!canTransitionRoute(route.status, to)) {
      throw new ConflictException(
        `Collection route ${route.routeNumber} cannot move from ${route.status} to ${to}`,
      );
    }
  }

  applyRouteStatus(
    route: CollectionRoute,
    to: CollectionRouteStatus,
    at = new Date(),
  ): CollectionRoute {
    this.assertRouteTransition(route, to);
    if (route.status === to) return route;

    const from = route.status;
    route.status = to;
    this.stampRoute(route, to, at);
    winstonLogger.info(
      `Collection route ${route.routeNumber}: ${from} -> ${to}`,
      LOG_META,
    );
    return route;
  }

  assertAssignmentTransition(
    assignment: CollectionRequestAssignment,
    to: CollectionRequestAssignmentStatus,
  ): void {
    if (assignment.status === to) return;
    if (!canTransitionAssignment(assignment.status, to)) {
      throw new ConflictException(
        `Assignment for request ${assignment.requestId} cannot move from ${assignment.status} to ${to}`,
      );
    }
  }

  applyAssignmentStatus(
    assignment: CollectionRequestAssignment,
    to: CollectionRequestAssignmentStatus,
    at = new Date(),
  ): CollectionRequestAssignment {
    this.assertAssignmentTransition(assignment, to);
    if (assignment.status === to) return assignment;

    const from = assignment.status;
    assignment.status = to;
    if (to !== CollectionRequestAssignmentStatus.OFFERED) {
      assignment.respondedAt = at;
    }
    winstonLogger.info(
      `Collection assignment ${assignment.id}: ${from} -> ${to}`,
      LOG_META,
    );
    return assignment;
  }

  /** Timestamps are part of the transition, not an afterthought at call sites. */
  private stampRequest(request: CollectionRequest, to: CollectionRequestStatus, at: Date): void {
    const stamps: Partial<Record<CollectionRequestStatus, () => void>> = {
      [CollectionRequestStatus.ASSIGNED]: () => (request.assignedAt = at),
      [CollectionRequestStatus.EN_ROUTE]: () => (request.enRouteAt = at),
      [CollectionRequestStatus.ARRIVED]: () => (request.arrivedAt = at),
      [CollectionRequestStatus.PICKING]: () => (request.pickedAt = at),
      [CollectionRequestStatus.DELIVERED]: () => (request.deliveredAt = at),
      [CollectionRequestStatus.COMPLETED]: () => (request.completedAt = at),
      [CollectionRequestStatus.CANCELLED]: () => (request.cancelledAt = at),
    };
    stamps[to]?.();
  }

  private stampRoute(route: CollectionRoute, to: CollectionRouteStatus, at: Date): void {
    const stamps: Partial<Record<CollectionRouteStatus, () => void>> = {
      [CollectionRouteStatus.IN_PROGRESS]: () => (route.startedAt = at),
      [CollectionRouteStatus.COMPLETED]: () => (route.completedAt = at),
      [CollectionRouteStatus.CANCELLED]: () => (route.cancelledAt = at),
    };
    stamps[to]?.();
  }
}
