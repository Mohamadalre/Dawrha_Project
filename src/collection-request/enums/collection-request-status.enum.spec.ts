import {
  canTransitionRequest,
  COLLECTION_REQUEST_TRANSITIONS,
  CollectionRequestStatus,
  PRODUCER_CANCELLABLE_STATUSES,
  TERMINAL_COLLECTION_REQUEST_STATUSES,
} from './collection-request-status.enum';
import {
  canTransitionRoute,
  CollectionRouteStatus,
} from './collection-route-status.enum';
import {
  canTransitionAssignment,
  CollectionRequestAssignmentStatus,
} from './collection-request-assignment-status.enum';

describe('Collection request state machine', () => {
  it('declares a transition map for every status', () => {
    for (const status of Object.values(CollectionRequestStatus)) {
      expect(COLLECTION_REQUEST_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('allows the documented moves only', () => {
    expect(canTransitionRequest(CollectionRequestStatus.CREATED, CollectionRequestStatus.QUEUED)).toBe(true);
    expect(canTransitionRequest(CollectionRequestStatus.CREATED, CollectionRequestStatus.CANCELLED)).toBe(true);
    expect(canTransitionRequest(CollectionRequestStatus.CREATED, CollectionRequestStatus.ASSIGNED)).toBe(false);
    expect(canTransitionRequest(CollectionRequestStatus.QUEUED, CollectionRequestStatus.ASSIGNED)).toBe(true);
    expect(canTransitionRequest(CollectionRequestStatus.QUEUED, CollectionRequestStatus.NEEDS_ADMIN)).toBe(true);
    expect(canTransitionRequest(CollectionRequestStatus.NEEDS_ADMIN, CollectionRequestStatus.QUEUED)).toBe(true);
    expect(canTransitionRequest(CollectionRequestStatus.NEEDS_ADMIN, CollectionRequestStatus.ASSIGNED)).toBe(false);
    expect(canTransitionRequest(CollectionRequestStatus.ARRIVED, CollectionRequestStatus.PICKING)).toBe(true);
    expect(canTransitionRequest(CollectionRequestStatus.PICKING, CollectionRequestStatus.CANCELLED)).toBe(false);
    expect(canTransitionRequest(CollectionRequestStatus.PICKING, CollectionRequestStatus.DELIVERED)).toBe(true);
    expect(canTransitionRequest(CollectionRequestStatus.DELIVERED, CollectionRequestStatus.COMPLETED)).toBe(true);
  });

  it('terminal statuses have no moves', () => {
    for (const status of TERMINAL_COLLECTION_REQUEST_STATUSES) {
      expect(COLLECTION_REQUEST_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('the producer cancellable window ends at ARRIVED', () => {
    expect(PRODUCER_CANCELLABLE_STATUSES).toContain(CollectionRequestStatus.CREATED);
    expect(PRODUCER_CANCELLABLE_STATUSES).toContain(CollectionRequestStatus.ARRIVED);
    expect(PRODUCER_CANCELLABLE_STATUSES).not.toContain(CollectionRequestStatus.PICKING);
    expect(PRODUCER_CANCELLABLE_STATUSES).not.toContain(CollectionRequestStatus.DELIVERED);
    expect(PRODUCER_CANCELLABLE_STATUSES).not.toContain(CollectionRequestStatus.COMPLETED);
  });
});

describe('Routing and assignment state machines', () => {
  it('routes: PLANNED can start or cancel; IN_PROGRESS can finish or cancel', () => {
    expect(canTransitionRoute(CollectionRouteStatus.PLANNED, CollectionRouteStatus.IN_PROGRESS)).toBe(true);
    expect(canTransitionRoute(CollectionRouteStatus.PLANNED, CollectionRouteStatus.CANCELLED)).toBe(true);
    expect(canTransitionRoute(CollectionRouteStatus.PLANNED, CollectionRouteStatus.COMPLETED)).toBe(false);
    expect(canTransitionRoute(CollectionRouteStatus.IN_PROGRESS, CollectionRouteStatus.COMPLETED)).toBe(true);
    expect(canTransitionRoute(CollectionRouteStatus.IN_PROGRESS, CollectionRouteStatus.CANCELLED)).toBe(true);
    expect(canTransitionRoute(CollectionRouteStatus.COMPLETED, CollectionRouteStatus.CANCELLED)).toBe(false);
  });

  it('assignments: only OFFERED can move, and only once', () => {
    expect(canTransitionAssignment(CollectionRequestAssignmentStatus.OFFERED, CollectionRequestAssignmentStatus.ACCEPTED)).toBe(true);
    expect(canTransitionAssignment(CollectionRequestAssignmentStatus.OFFERED, CollectionRequestAssignmentStatus.REJECTED)).toBe(true);
    expect(canTransitionAssignment(CollectionRequestAssignmentStatus.OFFERED, CollectionRequestAssignmentStatus.EXPIRED)).toBe(true);
    expect(canTransitionAssignment(CollectionRequestAssignmentStatus.OFFERED, CollectionRequestAssignmentStatus.WITHDRAWN)).toBe(true);
    expect(canTransitionAssignment(CollectionRequestAssignmentStatus.ACCEPTED, CollectionRequestAssignmentStatus.REJECTED)).toBe(false);
    expect(canTransitionAssignment(CollectionRequestAssignmentStatus.EXPIRED, CollectionRequestAssignmentStatus.ACCEPTED)).toBe(false);
  });
});