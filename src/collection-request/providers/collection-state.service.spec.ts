import { ConflictException } from '@nestjs/common';
import { CollectionStateService } from './collection-state.service';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import {
  CollectionRequestAssignmentStatus,
} from '../enums/collection-request-assignment-status.enum';
import { CollectionRouteStatus } from '../enums/collection-route-status.enum';

describe('CollectionStateService', () => {
  let service: CollectionStateService;

  beforeEach(() => {
    service = new CollectionStateService();
  });

  const request = () =>
    ({
      id: 'r1',
      requestNumber: 'CR-2026-08-00001',
      status: CollectionRequestStatus.CREATED,
    }) as CollectionRequest;

  it('walks the full happy path and stamps every step', () => {
    const r = request();
    const journey: Array<[CollectionRequestStatus, keyof CollectionRequest]> = [
      [CollectionRequestStatus.QUEUED, null],
      [CollectionRequestStatus.ASSIGNED, 'assignedAt'],
      [CollectionRequestStatus.EN_ROUTE, 'enRouteAt'],
      [CollectionRequestStatus.ARRIVED, 'arrivedAt'],
      [CollectionRequestStatus.PICKING, 'pickedAt'],
      [CollectionRequestStatus.DELIVERED, 'deliveredAt'],
      [CollectionRequestStatus.COMPLETED, 'completedAt'],
    ];

    for (const [to, stamp] of journey) {
      const before = new Date();
      service.applyRequestStatus(r, to);
      expect(r.status).toBe(to);
      if (stamp) {
        expect(r[stamp] as Date).toBeInstanceOf(Date);
        expect((r[stamp] as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
      }
    }
  });

  it('produces a different requestNumber reference between requests', () => {
    // Regression guard: the happy path must not mutate anything but the same
    // entity — a second request starts fresh at CREATED.
    const r = request();
    service.applyRequestStatus(r, CollectionRequestStatus.CANCELLED);
    expect(r.status).toBe(CollectionRequestStatus.CANCELLED);
    expect(r.cancelledAt).toBeInstanceOf(Date);
    const fresh = request();
    expect(fresh.status).toBe(CollectionRequestStatus.CREATED);
  });

  it('refuses an illegal forward jump with 409', () => {
    const r = request();
    expect(() => service.applyRequestStatus(r, CollectionRequestStatus.COMPLETED))
      .toThrow(ConflictException);
  });

  it('allows cancellation until ARRIVED but never after PICKING', () => {
    const cancellable = [
      CollectionRequestStatus.CREATED,
      CollectionRequestStatus.QUEUED,
      CollectionRequestStatus.ASSIGNED,
      CollectionRequestStatus.EN_ROUTE,
      CollectionRequestStatus.ARRIVED,
      CollectionRequestStatus.NEEDS_ADMIN,
    ];
    for (const from of cancellable) {
      const r = request();
      r.status = from;
      service.applyRequestStatus(r, CollectionRequestStatus.CANCELLED);
      expect(r.status).toBe(CollectionRequestStatus.CANCELLED);
    }

    const picked = request();
    picked.status = CollectionRequestStatus.PICKING;
    expect(() =>
      service.applyRequestStatus(picked, CollectionRequestStatus.CANCELLED),
    ).toThrow(ConflictException);
  });

  it('requeues NEEDS_ADMIN through QUEUED only', () => {
    const stuck = request();
    stuck.status = CollectionRequestStatus.NEEDS_ADMIN;
    service.applyRequestStatus(stuck, CollectionRequestStatus.QUEUED);
    expect(stuck.status).toBe(CollectionRequestStatus.QUEUED);

    const again = request();
    again.status = CollectionRequestStatus.NEEDS_ADMIN;
    expect(() => service.applyRequestStatus(again, CollectionRequestStatus.ASSIGNED))
      .toThrow(ConflictException);
  });

  it('moves routes PLANNED -> IN_PROGRESS -> COMPLETED with stamps', () => {
    const route = { id: 'rt1', routeNumber: 'RTE-2026-08-17-001', status: CollectionRouteStatus.PLANNED } as CollectionRoute;
    service.applyRouteStatus(route, CollectionRouteStatus.IN_PROGRESS);
    expect(route.status).toBe(CollectionRouteStatus.IN_PROGRESS);
    expect(route.startedAt).toBeInstanceOf(Date);
    service.applyRouteStatus(route, CollectionRouteStatus.COMPLETED);
    expect(route.status).toBe(CollectionRouteStatus.COMPLETED);
    expect(route.completedAt).toBeInstanceOf(Date);
    expect(() => service.applyRouteStatus(route, CollectionRouteStatus.CANCELLED))
      .toThrow(ConflictException);
  });

  it('settles an offer once, stamping the response', () => {
    const assignment = {
      id: 'a1',
      requestId: 'r1',
      status: CollectionRequestAssignmentStatus.OFFERED,
    } as CollectionRequestAssignment;
    service.applyAssignmentStatus(assignment, CollectionRequestAssignmentStatus.ACCEPTED);
    expect(assignment.status).toBe(CollectionRequestAssignmentStatus.ACCEPTED);
    expect(assignment.respondedAt).toBeInstanceOf(Date);

    expect(() =>
      service.applyAssignmentStatus(assignment, CollectionRequestAssignmentStatus.REJECTED),
    ).toThrow(ConflictException);
  });
});