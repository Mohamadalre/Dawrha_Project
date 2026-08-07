import { Role } from '@src/user/enums/role.enum';
import { PricingTier, tierForRole } from './pricing-tier.enum';

/**
 * Who an offer is for — and, because of that, WHICH WAY it moves the price.
 *
 * The platform stands between two sides of the same trade. Citizens and
 * institutions SELL their material to it; factories and free facilities BUY
 * sorted material from it. So "a better offer" means opposite things to them,
 * and an offer that did not know which side it was aimed at could not say what
 * it was offering:
 *
 *   SELLERS  → paid MORE  → the amount is ADDED to their price
 *   BUYERS   → charged LESS → the amount is SUBTRACTED from theirs
 *
 * The audience is the required choice; naming a specific role inside it is
 * optional and narrows the offer to one of the pair.
 */
export enum OfferAudience {
  SELLERS = 'SELLERS',
  BUYERS = 'BUYERS',
}

/** The roles each audience covers, in the order they are shown. */
export const AUDIENCE_ROLES: Readonly<Record<OfferAudience, readonly Role[]>> = {
  [OfferAudience.SELLERS]: [Role.CITIZEN, Role.INSTITUTIONS],
  [OfferAudience.BUYERS]: [Role.FACTORY, Role.EXTERNAL_PARTNER],
};

/** Which audience a role belongs to — null for roles that do not trade. */
export function audienceForRole(role: Role): OfferAudience | null {
  if (AUDIENCE_ROLES[OfferAudience.SELLERS].includes(role)) {
    return OfferAudience.SELLERS;
  }
  if (AUDIENCE_ROLES[OfferAudience.BUYERS].includes(role)) {
    return OfferAudience.BUYERS;
  }
  return null;
}

/**
 * Only BUYERS are priced per GRADE.
 *
 * A seller is paid one price for the material they hand over — the grading
 * happens afterwards, during sorting, so there is no grade to name at the
 * moment they are paid. Naming one on a seller offer describes a distinction
 * their price list does not have.
 */
export function audienceIsGraded(audience: OfferAudience): boolean {
  return audience === OfferAudience.BUYERS;
}

/**
 * The price after the offer.
 *
 * THE ONLY PLACE THE SIGN LIVES. Every screen that quotes a discounted price —
 * the catalogue, the basket, the guest apps, the sheet pushed to Odoo — reads
 * it from here, so none of them can add where another subtracts.
 *
 * Never returns a negative: the amount is validated against every price it
 * touches before an offer is stored, and this floors at zero as the last line
 * of defence rather than emitting a number that would be charged.
 */
export function priceAfterOffer(
  basePrice: number,
  amount: number,
  audience: OfferAudience,
): number {
  const moved =
    audience === OfferAudience.SELLERS ? basePrice + amount : basePrice - amount;
  return Math.max(Math.round(moved * 1000) / 1000, 0);
}

/**
 * How much the amount moves the price, as a percentage of it.
 *
 * Derived, never typed in: a hand-entered percentage is free to disagree with
 * the two numbers either side of it, and every "biggest offers" list would then
 * rank by somebody's arithmetic instead of by the money that changes hands.
 *
 * The sign is not encoded here — the audience already says which way it moves,
 * and a negative percentage on a seller offer would read as a cut.
 */
export function offerPercentage(basePrice: number, amount: number): number {
  if (!basePrice || basePrice <= 0) return 0;
  return Math.round((amount / basePrice) * 100 * 100) / 100;
}

/** Tiers an audience's roles are priced under. */
export function tiersForAudience(
  audience: OfferAudience,
  roles?: Role[] | null,
): PricingTier[] {
  const covered = roles?.length ? roles : [...AUDIENCE_ROLES[audience]];
  return covered.map((r) => tierForRole(r));
}
