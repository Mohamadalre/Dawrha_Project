/**
 * What a complaint is about — and, because of that, who can actually answer it.
 *
 * Routing by kind is not paperwork. A shortage is settled by looking at the
 * zone-movement log in Odoo, which records exactly what left the warehouse, who
 * deducted it and when; a late delivery is settled by looking at the trip. Send
 * either to the wrong desk and the person reading it has no evidence to decide
 * on, so it turns into an exchange of assertions.
 */
export enum ComplaintKind {
  /** Less arrived than was ordered. */
  SHORTAGE = 'SHORTAGE',
  /** The material was not the grade or type ordered. */
  QUALITY = 'QUALITY',
  /** Late, damaged in transit, or never arrived. */
  DELIVERY = 'DELIVERY',
  /** Wrong amount charged, or the invoice is wrong. */
  BILLING = 'BILLING',
  OTHER = 'OTHER',
}

/** Where a complaint of each kind is decided. */
export enum ComplaintRoute {
  /**
   * The warehouse manager, in Odoo — because the evidence lives there:
   * `recycle.order.zone.movement` records what physically left, from which
   * zone, deducted by whom, at what time.
   */
  WAREHOUSE = 'WAREHOUSE',
  /** The admin, here — delivery and billing are not the warehouse's doing. */
  ADMIN = 'ADMIN',
}

const ROUTE_BY_KIND: Record<ComplaintKind, ComplaintRoute> = {
  [ComplaintKind.SHORTAGE]: ComplaintRoute.WAREHOUSE,
  [ComplaintKind.QUALITY]: ComplaintRoute.WAREHOUSE,
  [ComplaintKind.DELIVERY]: ComplaintRoute.ADMIN,
  [ComplaintKind.BILLING]: ComplaintRoute.ADMIN,
  // Unclassified goes to the admin, who can see everything and reassign.
  [ComplaintKind.OTHER]: ComplaintRoute.ADMIN,
};

export function routeFor(kind: ComplaintKind): ComplaintRoute {
  return ROUTE_BY_KIND[kind];
}

export enum ComplaintStatus {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}
