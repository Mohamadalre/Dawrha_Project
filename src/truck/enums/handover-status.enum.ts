/**
 * Lifecycle of a truck-handover session (one driver, one shift, one day):
 * - OPEN: the driver picked up the truck and still holds it.
 * - CLOSED: he handed it back (dropped off).
 * - MISSED_PICKUP: his shift started but he never picked up — created by the
 *   missed-pickup cron so the alert fires once; a later pickup flips it to OPEN.
 */
export enum HandoverStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  MISSED_PICKUP = 'missed_pickup',
}
