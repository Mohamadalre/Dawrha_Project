/**
 * Every tunable of the ordering flow, in one place.
 *
 * These are business decisions, not implementation details, so they are named
 * constants rather than numbers buried in the allocator — and each carries the
 * reason it has the value it does.
 */

/**
 * How long a warehouse manager has to answer before the offer expires and the
 * part is reallocated. Long enough to cover a normal working day; short enough
 * that a buyer is not left waiting on someone who is on leave.
 */
export const OFFER_EXPIRY_HOURS = 24;

/**
 * Ceiling on reallocation attempts. The rejection ledger already prevents
 * asking the same warehouse twice, so the candidate list strictly shrinks — but
 * a ceiling is the guarantee that does not depend on that reasoning holding for
 * every future change.
 */
export const MAX_ALLOCATION_ROUNDS = 3;

/**
 * The largest shortfall (as a fraction of an order's quantity) that may be
 * shipped short WITHOUT asking the buyer again — and only if they opted into
 * partial fulfilment at checkout.
 */
export const PARTIAL_FULFILMENT_TOLERANCE = 0.05;

/**
 * How many warehouses an order may split across is NOT capped.
 *
 * There was once a per-mode ceiling (delivery 3, pickup 2), on the reasoning
 * that a split PICKUP made the buyer drive to every site. That reasoning no
 * longer holds: a split order can be CONSOLIDATED into the one warehouse nearest
 * the buyer (for factories and free facilities alike), and delivery has always
 * carried the extra trips itself. So an order now splits across as many
 * warehouses as it takes to cover it — bounded only by MAX_CANDIDATE_WAREHOUSES,
 * which limits the candidate pool for cost/compute reasons, not the split.
 */

/**
 * How many nearest warehouses are considered at all. Bounds the work and,
 * crucially, bounds the number of destinations sent to the distance provider —
 * which is billed per element.
 */
export const MAX_CANDIDATE_WAREHOUSES = 10;

/** Quantities below this are treated as zero (float noise from Odoo). */
export const QUANTITY_EPSILON = 0.0001;
