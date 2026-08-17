/**
 * Lifecycle of a buyer's order, from checkout to rating.
 *
 * There is no DRAFT: the cart IS the draft, and an `orders` row only exists
 * once the buyer has committed and the minimum-value check has passed.
 *
 * The one line that matters commercially is PREPARING — past it the stock has
 * left the shelf and the invoice exists, so the buyer can no longer cancel.
 */
export enum OrderStatus {
  /** Committed; the allocator is choosing warehouses and reserving stock. */
  PENDING_ALLOCATION = 'PENDING_ALLOCATION',
  /** Parts are offered to warehouse managers; ALL must accept. */
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  /** Not fully coverable: the buyer must accept less or walk away. */
  NEEDS_CUSTOMER_DECISION = 'NEEDS_CUSTOMER_DECISION',
  /**
   * A SPLIT order the Odoo administrator refused as a whole. Unlike a single
   * warehouse's rejection — which quietly re-allocates elsewhere — a split is
   * decided in one verdict for all its parts, so there is nothing left to try:
   * the buyer is told, and the order waits ONLY for them to confirm before it
   * closes. Never re-allocated.
   */
  REJECTED_AWAITING_BUYER = 'REJECTED_AWAITING_BUYER',
  /** Allocation gave up (round cap reached) — a human has to look. */
  NEEDS_ADMIN = 'NEEDS_ADMIN',
  /** Every part accepted. Point of no return: cancellation closes here. */
  PREPARING = 'PREPARING',
  /** Delivery only — goods are on the road. */
  IN_TRANSIT = 'IN_TRANSIT',
  /**
   * Consolidation only — a delivery truck is gathering the FAR warehouses'
   * parts into the ONE warehouse nearest the buyer, so they can collect
   * everything from a single place. Shown to the buyer as "being gathered".
   */
  CONSOLIDATING = 'CONSOLIDATING',
  /** Self-collection — goods wait at each warehouse's output zone. */
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  /** Every part handed over. */
  DELIVERED = 'DELIVERED',
  /** The buyer confirmed receipt and rated it. */
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/**
 * Allowed moves. A map rather than a chain of conditions: the whole lifecycle
 * is readable in one place, an illegal move is impossible to write by accident,
 * and adding a state is one entry instead of hunting for every `if` that
 * mentions the old ones.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PENDING_ALLOCATION]: [
    OrderStatus.AWAITING_APPROVAL,
    OrderStatus.NEEDS_CUSTOMER_DECISION,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.AWAITING_APPROVAL]: [
    // Re-allocation after a rejection re-enters allocation.
    OrderStatus.PENDING_ALLOCATION,
    OrderStatus.PREPARING,
    OrderStatus.NEEDS_ADMIN,
    // A split refused by the admin goes to the buyer, not back to allocation.
    OrderStatus.REJECTED_AWAITING_BUYER,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.NEEDS_CUSTOMER_DECISION]: [
    OrderStatus.PENDING_ALLOCATION,
    OrderStatus.CANCELLED,
  ],
  // The buyer's only move is to confirm, which closes the order.
  [OrderStatus.REJECTED_AWAITING_BUYER]: [OrderStatus.CANCELLED],
  [OrderStatus.NEEDS_ADMIN]: [
    OrderStatus.PENDING_ALLOCATION,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PREPARING]: [
    OrderStatus.IN_TRANSIT,
    // Consolidation gathers the split parts into one warehouse before pickup.
    OrderStatus.CONSOLIDATING,
    OrderStatus.READY_FOR_PICKUP,
  ],
  [OrderStatus.IN_TRANSIT]: [OrderStatus.DELIVERED],
  // Once gathered, a consolidation order is collected from the nearest warehouse.
  [OrderStatus.CONSOLIDATING]: [OrderStatus.READY_FOR_PICKUP],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

/**
 * The buyer may cancel only before the goods are committed. Expressed as a set
 * derived from the lifecycle, so "when can I cancel?" has exactly one answer in
 * the codebase.
 */
export const BUYER_CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING_ALLOCATION,
  OrderStatus.AWAITING_APPROVAL,
  OrderStatus.NEEDS_CUSTOMER_DECISION,
  OrderStatus.REJECTED_AWAITING_BUYER,
  OrderStatus.NEEDS_ADMIN,
];

/** Statuses in which the order is finished and nothing more will happen. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
