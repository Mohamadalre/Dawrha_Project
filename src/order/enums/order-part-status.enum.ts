/**
 * Lifecycle of ONE warehouse's share of an order.
 *
 * A split order has one part per warehouse, and each part runs this cycle on
 * its own — its own output employee, its own invoice, its own handover. The
 * parent order's status is derived from the parts, never the other way round.
 *
 * Two people touch a part inside the warehouse, and the boundary between them
 * is exact:
 *
 *   OUTPUT EMPLOYEE — the whole of PREPARATION: takes the order, deducts the
 *   stock from the zones they picked, generates the invoice, and moves the
 *   goods to an output zone. The manager takes no part in any of it.
 *
 *   WAREHOUSE MANAGER — two moments only: accepting the order in the first
 *   place, and confirming the prepared goods physically LEFT — to the carrier
 *   when the buyer chose delivery, or to the buyer when they collect.
 *
 * So IN_OUTPUT_ZONE means "prepared and waiting", never "gone". What comes
 * after it is the manager's confirmation.
 */
export enum OrderPartStatus {
  /** Stock reserved, waiting for the warehouse manager's decision. */
  OFFERED = 'OFFERED',
  /** The manager accepted; it is now in the output employees' queue. */
  ACCEPTED = 'ACCEPTED',
  /** An output employee took it (Odoo: processing). */
  PROCESSING = 'PROCESSING',
  /** The output employee deducted the stock and invoiced it (Odoo: ready). */
  STOCK_DEDUCTED = 'STOCK_DEDUCTED',
  /**
   * The output employee finished: goods sit in an output zone (Odoo:
   * completed). Prepared — not yet gone.
   */
  IN_OUTPUT_ZONE = 'IN_OUTPUT_ZONE',
  /**
   * Collection order: waiting for the buyer to come. Reached automatically
   * once preparation is done, because for a collection there is nothing
   * further to arrange.
   */
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  /** Delivery: the MANAGER confirmed the goods went to the carrier. */
  DISPATCHED = 'DISPATCHED',
  /**
   * Collection: the MANAGER confirmed the buyer took them.
   * Delivery: the buyer confirmed the goods arrived.
   */
  DELIVERED = 'DELIVERED',

  /** The manager refused it — reallocation excludes this warehouse. */
  REJECTED = 'REJECTED',
  /** Nobody answered in time — treated exactly like a rejection. */
  EXPIRED = 'EXPIRED',
  /** The buyer cancelled the whole order before it was committed. */
  CANCELLED = 'CANCELLED',
}

export const ORDER_PART_TRANSITIONS: Record<
  OrderPartStatus,
  readonly OrderPartStatus[]
> = {
  [OrderPartStatus.OFFERED]: [
    OrderPartStatus.ACCEPTED,
    OrderPartStatus.REJECTED,
    OrderPartStatus.EXPIRED,
    OrderPartStatus.CANCELLED,
  ],
  [OrderPartStatus.ACCEPTED]: [
    OrderPartStatus.PROCESSING,
    OrderPartStatus.CANCELLED,
  ],
  [OrderPartStatus.PROCESSING]: [
    OrderPartStatus.STOCK_DEDUCTED,
    // The output employee can release it back to the queue.
    OrderPartStatus.ACCEPTED,
  ],
  [OrderPartStatus.STOCK_DEDUCTED]: [OrderPartStatus.IN_OUTPUT_ZONE],
  [OrderPartStatus.IN_OUTPUT_ZONE]: [
    // Delivery: the manager confirms the load left with the carrier.
    OrderPartStatus.DISPATCHED,
    // Collection: nothing more to arrange, so the buyer can come at once.
    OrderPartStatus.READY_FOR_PICKUP,
  ],
  [OrderPartStatus.DISPATCHED]: [
    OrderPartStatus.DELIVERED,
    // Consolidation: a far part the truck carried arrives at the nearest
    // warehouse and waits there for the buyer — dispatched from its origin, now
    // ready to collect at the gathering point (not delivered to the buyer).
    OrderPartStatus.READY_FOR_PICKUP,
  ],
  // The manager confirms the buyer took it.
  [OrderPartStatus.READY_FOR_PICKUP]: [OrderPartStatus.DELIVERED],
  [OrderPartStatus.DELIVERED]: [],
  [OrderPartStatus.REJECTED]: [],
  [OrderPartStatus.EXPIRED]: [],
  [OrderPartStatus.CANCELLED]: [],
};

/**
 * Statuses that end a part WITHOUT it being fulfilled. They are what the
 * allocator subtracts from its candidate list, which is how a warehouse that
 * said no is never asked twice for the same order.
 */
export const FAILED_PART_STATUSES: readonly OrderPartStatus[] = [
  OrderPartStatus.REJECTED,
  OrderPartStatus.EXPIRED,
];

/** A part still holding a stock reservation. */
export const RESERVING_PART_STATUSES: readonly OrderPartStatus[] = [
  OrderPartStatus.OFFERED,
  OrderPartStatus.ACCEPTED,
  OrderPartStatus.PROCESSING,
];

export function canTransitionPart(
  from: OrderPartStatus,
  to: OrderPartStatus,
): boolean {
  return ORDER_PART_TRANSITIONS[from].includes(to);
}
