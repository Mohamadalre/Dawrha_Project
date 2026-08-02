/**
 * A truck's run, from planned route to goods in the buyer's yard.
 *
 * Deliberately short. Every extra state here is a state the driver has to be
 * taught and the dispatcher has to interpret, and the only questions anyone
 * actually asks of a trip are: is it going to happen, is it happening now, did
 * it finish, was it called off.
 *
 * What happened at each WAREHOUSE is not a trip status — it belongs to the
 * stop, because a trip in progress has some stops collected and some not, and
 * one field cannot say that.
 */
export enum DeliveryTripStatus {
  /**
   * The route is built and costed, but no truck is on it. The parts may still
   * be being prepared.
   */
  PLANNED = 'PLANNED',
  /** A truck and driver are assigned; the driver has not set off. */
  ASSIGNED = 'ASSIGNED',
  /** The driver confirmed the first pickup — goods are in their custody. */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Every stop collected and the load handed to the buyer. */
  COMPLETED = 'COMPLETED',
  /** Called off before completion; the parts return to awaiting dispatch. */
  CANCELLED = 'CANCELLED',
}

export const DELIVERY_TRIP_TRANSITIONS: Record<
  DeliveryTripStatus,
  readonly DeliveryTripStatus[]
> = {
  [DeliveryTripStatus.PLANNED]: [
    DeliveryTripStatus.ASSIGNED,
    DeliveryTripStatus.CANCELLED,
  ],
  [DeliveryTripStatus.ASSIGNED]: [
    DeliveryTripStatus.IN_PROGRESS,
    // Reassigning a truck drops back to PLANNED rather than inventing an
    // "unassigned" state that means the same thing.
    DeliveryTripStatus.PLANNED,
    DeliveryTripStatus.CANCELLED,
  ],
  [DeliveryTripStatus.IN_PROGRESS]: [
    DeliveryTripStatus.COMPLETED,
    // Cancellable mid-route: a breakdown is a real event, and the goods
    // already collected have to go back.
    DeliveryTripStatus.CANCELLED,
  ],
  [DeliveryTripStatus.COMPLETED]: [],
  [DeliveryTripStatus.CANCELLED]: [],
};

export function canTransitionTrip(
  from: DeliveryTripStatus,
  to: DeliveryTripStatus,
): boolean {
  return DELIVERY_TRIP_TRANSITIONS[from].includes(to);
}
