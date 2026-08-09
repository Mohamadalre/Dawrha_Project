/**
 * Why a price row was moved from the live `product_pricing` table into the
 * `product_pricing_history` archive.
 */
export enum PricingArchiveReason {
  /** Replaced by a newer price (full-list update or single-tier edit). */
  UPDATED = 'UPDATED',
  /** The whole price list was deleted by an admin. */
  DELETED = 'DELETED',
  /**
   * An admin-set expiry date arrived: the row was swept out of the live table
   * by the expiry job, the material fell out of every buyer catalogue, and the
   * admin was notified to re-price it.
   */
  EXPIRED = 'EXPIRED',
}
