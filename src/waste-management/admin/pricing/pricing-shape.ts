import { PricingTier } from '../../enums/pricing-tier.enum';

/**
 * Which tiers are priced per grade, and when.
 *
 * The rule the whole pricing screen turns on, in one place:
 *
 *   material HAS grades      → FACTORY and FREE_FACILITY need a price PER grade;
 *                              INDIVIDUAL and COMPANY still get one price each.
 *   material has NO grades   → EVERY tier gets exactly one price, factories
 *                              included. There is nothing to price per grade,
 *                              so demanding a grade would be asking for a value
 *                              that does not exist.
 *
 * Why individuals and companies never price per grade even when the material is
 * graded: they buy the material, not a sorted quality band. Grading is what the
 * warehouse does for industrial buyers, and pricing it for everyone would force
 * an admin to invent numbers nobody uses.
 */

/** Tiers that MAY be priced per grade — only when the material has grades. */
export const GRADED_TIERS: readonly PricingTier[] = [
  PricingTier.FACTORY,
  PricingTier.FREE_FACILITY,
];

/** Tiers that are always a single price, whatever the material. */
export const FLAT_TIERS: readonly PricingTier[] = [
  PricingTier.INDIVIDUAL,
  PricingTier.COMPANY,
];

/**
 * Should this tier carry one price per grade for this material?
 *
 * Both arguments matter, and that is the point: the same tier is priced
 * differently depending on the material in front of it.
 */
export function isPricedPerCondition(
  tier: PricingTier,
  materialHasConditions: boolean,
): boolean {
  return materialHasConditions && GRADED_TIERS.includes(tier);
}

/** Human explanation used in validation errors, so a 400 teaches the rule. */
export function describeExpectedShape(
  tier: PricingTier,
  materialHasConditions: boolean,
): string {
  return isPricedPerCondition(tier, materialHasConditions)
    ? `${tier} is priced per condition for this material — send one price for each of its conditions`
    : `${tier} takes a single price for this material — do not send a condition`;
}
