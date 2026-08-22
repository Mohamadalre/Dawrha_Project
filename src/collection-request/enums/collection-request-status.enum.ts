/**
 * Lifecycle of a collection request, from the citizen/institution's order to
 * the completed pickup.
 *
 * There is no DRAFT: the producer commits directly (no cart), and a
 * `collection_requests` row only exists once materials and quantities are set.
 *
 * The commercially important line is PICKING — past it the driver has the
 * materials in hand and the owner can no longer cancel. The estimated totals
 * were already snapped at creation; from PICKING on, only the actuals the
 * driver weighs may change.
 */
export enum CollectionRequestStatus {
  /** Committed by the producer; waiting to enter the dispatch queue. */
  CREATED = 'CREATED',
  /** In the dispatch queue; the engine is electing a driver. */
  QUEUED = 'QUEUED',
  /** A driver accepted the offer; the request has a route slot. */
  ASSIGNED = 'ASSIGNED',
  /** The driver is heading to the pickup address. */
  EN_ROUTE = 'EN_ROUTE',
  /** The driver arrived at the pickup address. */
  ARRIVED = 'ARRIVED',
  /** The driver is weighing and loading the materials. */
  PICKING = 'PICKING',
  /** The materials were handed over; the intake job was sent to Odoo. */
  DELIVERED = 'DELIVERED',
  /** The Odoo intake was confirmed (or bypassed); payment basis is fixed. */
  COMPLETED = 'COMPLETED',
  /** The election ran out of candidates — a human has to look. */
  NEEDS_ADMIN = 'NEEDS_ADMIN',
  CANCELLED = 'CANCELLED',
}

/**
 * Allowed moves. A map rather than a chain of conditions: the whole lifecycle
 * is readable in one place, an illegal move is impossible to write by accident,
 * and adding a state is one entry instead of hunting for every `if` that
 * mentions the old ones.
 */
export const COLLECTION_REQUEST_TRANSITIONS: Record<
  CollectionRequestStatus,
  readonly CollectionRequestStatus[]
> = {
  // Immediate requests enter the queue right away; scheduled ones wait for
  // their lead-time job. The owner may cancel from either.
  [CollectionRequestStatus.CREATED]: [
    CollectionRequestStatus.QUEUED,
    CollectionRequestStatus.CANCELLED,
  ],
  [CollectionRequestStatus.QUEUED]: [
    CollectionRequestStatus.ASSIGNED,
    // The engine gave up: no candidate passed the hard filters.
    CollectionRequestStatus.NEEDS_ADMIN,
    CollectionRequestStatus.CANCELLED,
  ],
  // Once assigned the driver is bound to the route slot; the owner may still
  // cancel while the driver is on the way.
  [CollectionRequestStatus.ASSIGNED]: [
    CollectionRequestStatus.EN_ROUTE,
    CollectionRequestStatus.CANCELLED,
  ],
  [CollectionRequestStatus.EN_ROUTE]: [
    CollectionRequestStatus.ARRIVED,
    CollectionRequestStatus.CANCELLED,
  ],
  [CollectionRequestStatus.ARRIVED]: [
    CollectionRequestStatus.PICKING,
    CollectionRequestStatus.CANCELLED,
  ],
  // PICKING is the point of no return: the materials left the producer's hands.
  [CollectionRequestStatus.PICKING]: [CollectionRequestStatus.DELIVERED],
  [CollectionRequestStatus.DELIVERED]: [CollectionRequestStatus.COMPLETED],
  [CollectionRequestStatus.COMPLETED]: [],
  // The admin may requeue a stuck request for a fresh election.
  [CollectionRequestStatus.NEEDS_ADMIN]: [
    CollectionRequestStatus.QUEUED,
    CollectionRequestStatus.CANCELLED,
  ],
  [CollectionRequestStatus.CANCELLED]: [],
};

/**
 * The producer may cancel only before the driver starts picking. Expressed as
 * a set derived from the lifecycle, so "when can I cancel?" has exactly one
 * answer in the codebase.
 */
export const PRODUCER_CANCELLABLE_STATUSES: readonly CollectionRequestStatus[] = [
  CollectionRequestStatus.CREATED,
  CollectionRequestStatus.QUEUED,
  CollectionRequestStatus.ASSIGNED,
  CollectionRequestStatus.EN_ROUTE,
  CollectionRequestStatus.ARRIVED,
  CollectionRequestStatus.NEEDS_ADMIN,
];

/** Statuses in which the request is finished and nothing more will happen. */
export const TERMINAL_COLLECTION_REQUEST_STATUSES: readonly CollectionRequestStatus[] = [
  CollectionRequestStatus.COMPLETED,
  CollectionRequestStatus.CANCELLED,
];

export function canTransitionRequest(
  from: CollectionRequestStatus,
  to: CollectionRequestStatus,
): boolean {
  return COLLECTION_REQUEST_TRANSITIONS[from].includes(to);
}
