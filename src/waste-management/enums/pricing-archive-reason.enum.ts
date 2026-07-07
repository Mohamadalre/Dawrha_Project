/**
 * Why a price row was moved from the live `product_pricing` table into the
 * `product_pricing_history` archive.
 */
export enum PricingArchiveReason {
  /** Replaced by a newer price (full-list update or single-tier edit). */
  UPDATED = 'UPDATED',
  /** The whole price list was deleted by an admin. */
  DELETED = 'DELETED',
}
