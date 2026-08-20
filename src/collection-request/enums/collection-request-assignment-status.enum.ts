/**
 * Lifecycle of one election offer inside the dispatch ledger.
 *
 * Every time the engine elects a driver for a request it writes a row here
 * (OFFERED); the driver either accepts inside the accept window, or the offer
 * expires and the engine offers to the next candidate. The ledger makes the
 * whole election replayable for audits and debugging.
 */
export enum CollectionRequestAssignmentStatus {
  /** The engine elected this driver; waiting for their accept. */
  OFFERED = 'OFFERED',
  /** The driver accepted; the request becomes ASSIGNED to them. */
  ACCEPTED = 'ACCEPTED',
  /** The driver declined; the engine moves to the next candidate. */
  REJECTED = 'REJECTED',
  /** The accept window (Redis TTL) lapsed without a response. */
  EXPIRED = 'EXPIRED',
  /** The engine withdrew the offer (e.g. the request was cancelled). */
  WITHDRAWN = 'WITHDRAWN',
}

export const ASSIGNMENT_TRANSITIONS: Record<
  CollectionRequestAssignmentStatus,
  readonly CollectionRequestAssignmentStatus[]
> = {
  [CollectionRequestAssignmentStatus.OFFERED]: [
    CollectionRequestAssignmentStatus.ACCEPTED,
    CollectionRequestAssignmentStatus.REJECTED,
    CollectionRequestAssignmentStatus.EXPIRED,
    CollectionRequestAssignmentStatus.WITHDRAWN,
  ],
  // A settled offer is terminal: later offers for the same request are new rows.
  [CollectionRequestAssignmentStatus.ACCEPTED]: [],
  [CollectionRequestAssignmentStatus.REJECTED]: [],
  [CollectionRequestAssignmentStatus.EXPIRED]: [],
  [CollectionRequestAssignmentStatus.WITHDRAWN]: [],
};

export function canTransitionAssignment(
  from: CollectionRequestAssignmentStatus,
  to: CollectionRequestAssignmentStatus,
): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}
