/**
 * What a truck is FOR. Authored in Odoo, mirrored here.
 *
 * The fleet does two unrelated jobs and they had been one pool:
 *
 *  COLLECTION — goes out to citizens and institutions to pick material up.
 *               Driven by a COLLECTOR, whose account lives in this backend and
 *               who works a shift. This is the only kind the driver app ever
 *               touches.
 *  DELIVERY   — carries sold goods from a warehouse to the buyer who bought
 *               them. Driven by a delivery driver recruited inside Odoo, with no
 *               account here and no shift at all.
 *
 * Mirrored rather than inferred: without it the admin fleet screen lists both
 * kinds side by side with nothing to tell them apart, and "why is that truck
 * never assigned to anyone?" has no answer visible on the row.
 */
export enum TruckType {
  COLLECTION = 'COLLECTION',
  DELIVERY = 'DELIVERY',
}

/**
 * Odoo's lower-case selection value → our enum.
 *
 * Defaults to COLLECTION for anything unrecognised, which is what the whole
 * fleet was before the split: a truck of unknown kind is far likelier to be an
 * ordinary collection truck than a delivery one, and guessing DELIVERY would
 * quietly hide it from the collector assignment screens.
 */
export function truckTypeFromOdoo(value: unknown): TruckType {
  return String(value ?? '').trim().toLowerCase() === 'delivery'
    ? TruckType.DELIVERY
    : TruckType.COLLECTION;
}
