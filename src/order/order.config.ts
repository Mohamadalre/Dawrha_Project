import { FulfilmentMode } from './enums/fulfilment-mode.enum';

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
 * Most warehouses an order may be split across, per fulfilment mode.
 *
 * Delivery and collection are not comparable here. With delivery the company
 * absorbs the extra trips; with collection the BUYER drives to every site, so a
 * three-way split turns one errand into three. A free facility — which never
 * gets delivery — may not even own a suitable vehicle, which is why the pickup
 * ceiling is deliberately tight.
 */
export const MAX_PARTS_BY_MODE: Record<FulfilmentMode, number> = {
  [FulfilmentMode.DELIVERY]: 3,
  [FulfilmentMode.PICKUP]: 2,
};

/**
 * Penalty, in "equivalent kilometres", charged per EXTRA warehouse when
 * comparing plans.
 *
 * This is what stops the allocator from cheerfully splitting an order across
 * three near warehouses when one slightly farther warehouse could serve it
 * whole. Every extra part is another manager who must approve, another chance
 * of refusal, another invoice — costs that distance alone does not express.
 *
 * Much heavier for collection, for the same reason the part ceiling is lower.
 */
export const SPLIT_PENALTY_KM: Record<FulfilmentMode, number> = {
  [FulfilmentMode.DELIVERY]: 15,
  [FulfilmentMode.PICKUP]: 60,
};

/**
 * How many nearest warehouses are considered at all. Bounds the work and,
 * crucially, bounds the number of destinations sent to the distance provider —
 * which is billed per element.
 */
export const MAX_CANDIDATE_WAREHOUSES = 10;

/** Quantities below this are treated as zero (float noise from Odoo). */
export const QUANTITY_EPSILON = 0.0001;
