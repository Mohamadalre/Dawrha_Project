import { OrderPartStatus } from './enums/order-part-status.enum';
import { FulfilmentMode } from './enums/fulfilment-mode.enum';

/**
 * What each thing a warehouse does in Odoo means for the buyer's order.
 *
 * A lookup table rather than a chain of conditions: every event Odoo can send
 * is visible in one place, adding one is a single entry, and no branch can be
 * forgotten. Anything not listed is ignored rather than guessed at — silently
 * inventing a status from an unrecognised event is how an order ends up
 * claiming to be somewhere it is not.
 */
export const ODOO_EVENT_TO_PART_STATUS: Readonly<
  Record<string, OrderPartStatus>
> = {
  /** The manager accepted — this part is now the output employees' work. */
  manager_approved: OrderPartStatus.ACCEPTED,
  /** The manager refused — the allocator will look elsewhere. */
  manager_rejected: OrderPartStatus.REJECTED,
  /** An output employee took it. */
  processing: OrderPartStatus.PROCESSING,
  /** Stock deducted from the chosen zones and the invoice generated. */
  stock_deducted: OrderPartStatus.STOCK_DEDUCTED,
  /**
   * The output employee finished: goods are in an output zone.
   * Prepared — not yet gone. The manager's handover is what comes next.
   */
  completed: OrderPartStatus.IN_OUTPUT_ZONE,
};

/**
 * Where the goods went when the MANAGER confirmed the handover — the only
 * event whose meaning depends on a second field.
 *
 * To the carrier, the buyer's order becomes "on the way". Collected by the
 * buyer, that part is delivered outright.
 */
export const HANDOVER_TYPE_TO_PART_STATUS: Readonly<
  Record<string, OrderPartStatus>
> = {
  carrier: OrderPartStatus.DISPATCHED,
  buyer: OrderPartStatus.DELIVERED,
};

/**
 * Resolves one Odoo event to the status the part should now hold, or null when
 * the event carries no status meaning.
 */
export function resolvePartStatus(
  event: string,
  handoverType?: string,
): OrderPartStatus | null {
  if (event === 'handed_over') {
    return HANDOVER_TYPE_TO_PART_STATUS[handoverType ?? ''] ?? null;
  }
  return ODOO_EVENT_TO_PART_STATUS[event] ?? null;
}

/**
 * A collection order needs nothing arranged once it is prepared, so the buyer
 * may set off the moment the goods reach the output zone. A delivery order
 * instead waits for the manager to confirm it left with a carrier — which is
 * why only PICKUP auto-advances here.
 *
 * A CONSOLIDATION order is the exception among collections: its far parts must
 * be GATHERED into the nearest warehouse before the buyer collects, so they
 * stay in the output zone (prepared, not yet ready) until the consolidation
 * trip has run. It is the trip's completion — not preparation — that makes a
 * consolidation part READY_FOR_PICKUP.
 */
export function autoAdvanceAfterPreparation(
  status: OrderPartStatus,
  mode: FulfilmentMode,
  consolidate = false,
): OrderPartStatus | null {
  if (status !== OrderPartStatus.IN_OUTPUT_ZONE) return null;
  if (consolidate) return null;
  return mode === FulfilmentMode.PICKUP ? OrderPartStatus.READY_FOR_PICKUP : null;
}
