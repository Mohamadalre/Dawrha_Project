/**
 * How the administrator EXPRESSED the offer — and therefore what must happen
 * to it when the underlying price later moves.
 *
 * Both bases store the same `amount`, because everything downstream applies an
 * amount: the catalogue, the basket, the invoice and the Odoo sheet all read
 * one number and move the price by it. What differs is whether that number is
 * the thing that was MEANT, or a consequence of it.
 *
 *   AMOUNT     — "take 5 off". The 5 is the promise. If the list price moves
 *                from 80 to 100, the offer is still 5 off, now 95.
 *
 *   PERCENTAGE — "take 25% off". The 25% is the promise, and the amount is
 *                merely today's arithmetic. If the list price moves from 80 to
 *                100, the amount MUST be recomputed to 25 — leaving it at 20
 *                would silently turn a quarter off into a fifth off.
 *
 * Storing the basis is what makes that second case possible at all. Without
 * it, an offer created as a percentage is indistinguishable from one created
 * as an amount the moment it is written, and a later price edit has no way to
 * know which of the two the administrator actually agreed to.
 *
 * The DERIVED `discountPercentage` column is not this. That column is what the
 * amount currently represents — recomputed for every offer, whatever its basis
 * — so lists can rank by real money. This enum records intent; that column
 * records effect.
 */
export enum OfferBasis {
  /** The amount is fixed; the percentage follows the price. */
  AMOUNT = 'AMOUNT',
  /** The percentage is fixed; the amount is recomputed when the price moves. */
  PERCENTAGE = 'PERCENTAGE',
}

/**
 * The amount a percentage comes to against a given price.
 *
 * Rounded to three decimals to match the money columns, so the stored amount
 * is exactly what will be applied rather than a value that drifts on the way
 * to the invoice.
 */
export function amountFromPercentage(basePrice: number, percentage: number): number {
  return Math.round(basePrice * (percentage / 100) * 1000) / 1000;
}
