/**
 * Outcome of asking one warehouse to take one part.
 *
 * EXPIRED and REJECTED are kept apart even though the allocator treats them
 * identically: "the manager refused" and "nobody looked" are different
 * operational problems, and an admin reviewing why an order struggled needs to
 * be able to tell them apart.
 */
export enum OrderOfferStatus {
  /** Sent to the manager; awaiting a decision. */
  OFFERED = 'OFFERED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  /** The deadline passed with no answer. */
  EXPIRED = 'EXPIRED',
  /** The buyer cancelled, so the question no longer stands. */
  WITHDRAWN = 'WITHDRAWN',
}

/**
 * Outcomes that permanently disqualify a warehouse FOR THIS ORDER. Subtracting
 * these from the candidate list is what guarantees reallocation terminates.
 *
 * WITHDRAWN is deliberately absent: the order was cancelled, not refused, so
 * the warehouse never actually said no.
 */
export const DISQUALIFYING_OFFER_STATUSES: readonly OrderOfferStatus[] = [
  OrderOfferStatus.REJECTED,
  OrderOfferStatus.EXPIRED,
];
