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
   * The material gained its FIRST grade, so it is now priced per grade for the
   * factory / free-facility tiers. Their old CONDITIONLESS (base) price no
   * longer applies and was swept out here — individual / company base prices are
   * untouched, because those tiers are never priced per grade.
   */
  GRADED = 'GRADED',
  /**
   * An admin-set expiry date arrived: the row was swept out of the live table
   * by the expiry job, the material fell out of every buyer catalogue, and the
   * admin was notified to re-price it.
   */
  EXPIRED = 'EXPIRED',
}
