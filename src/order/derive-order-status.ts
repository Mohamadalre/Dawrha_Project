import { OrderStatus } from './enums/order-status.enum';
import {
  FAILED_PART_STATUSES,
  OrderPartStatus,
} from './enums/order-part-status.enum';
import { FulfilmentMode } from './enums/fulfilment-mode.enum';

/** The minimum a caller must know about a part to derive an order's status. */
export interface PartStatusView {
  status: OrderPartStatus;
}

/**
 * The status the parent order should hold, derived from its parts.
 *
 * Derived, never set directly. An order is a view over its parts, so a split
 * order that "moved on" while one warehouse was still working would be telling
 * the buyer something they could act on and be wrong about. Hence the rule
 * throughout: **the slowest part decides**.
 *
 * Pure, so both the state service and the Odoo event handler can use it
 * without either depending on the other.
 *
 * Returns null when every part failed — that is not a status, it is a signal
 * that the order needs reallocating or abandoning.
 */
export function deriveOrderStatus(
  mode: FulfilmentMode,
  parts: PartStatusView[],
): OrderStatus | null {
  const live = parts.filter(
    (p) =>
      !FAILED_PART_STATUSES.includes(p.status) &&
      p.status !== OrderPartStatus.CANCELLED,
  );
  if (!live.length) return null;

  const every = (allowed: OrderPartStatus[]) =>
    live.every((p) => allowed.includes(p.status));

  if (every([OrderPartStatus.DELIVERED])) return OrderStatus.DELIVERED;

  // "On the way" only once the manager of EVERY part confirmed the load left.
  // A part still sitting in its output zone is prepared, not gone.
  if (every([OrderPartStatus.DISPATCHED, OrderPartStatus.DELIVERED])) {
    return OrderStatus.IN_TRANSIT;
  }

  // Collection: the buyer may set off once every part is prepared.
  if (every([OrderPartStatus.READY_FOR_PICKUP, OrderPartStatus.DELIVERED])) {
    return OrderStatus.READY_FOR_PICKUP;
  }

  // Preparing from the moment every manager has accepted — this is the point
  // of no return the buyer was warned about.
  if (
    every([
      OrderPartStatus.ACCEPTED,
      OrderPartStatus.PROCESSING,
      OrderPartStatus.STOCK_DEDUCTED,
      OrderPartStatus.IN_OUTPUT_ZONE,
      OrderPartStatus.DISPATCHED,
      OrderPartStatus.READY_FOR_PICKUP,
      OrderPartStatus.DELIVERED,
    ])
  ) {
    return OrderStatus.PREPARING;
  }

  // Anything still OFFERED keeps the whole order waiting.
  return OrderStatus.AWAITING_APPROVAL;
}
