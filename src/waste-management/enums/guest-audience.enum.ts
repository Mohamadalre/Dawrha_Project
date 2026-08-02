import { Role } from '@src/user/enums/role.enum';
import { PricingTier } from './pricing-tier.enum';

/**
 * Which app a visitor is browsing from.
 *
 * Price is a function of the buyer's TIER, so a visitor cannot be quoted at all
 * until we know which kind of buyer they would become. The two apps answer that
 * question before anyone signs in: whoever opens the factory app is going to be
 * a factory or a free facility, and whoever opens the user app is going to be an
 * individual or an institution. That is what makes a guest price sheet possible
 * here when a single, app-agnostic guest route could only ever withhold it.
 *
 * Each audience therefore carries its OWN tiers and its OWN roles, and the two
 * never mix: a visitor in the user app must not be able to read a factory sheet
 * by changing a query parameter, so the audience is fixed by the ROUTE and is
 * never taken from the request.
 */
export enum GuestAudience {
  /** Citizens and institutions — the user app. */
  USER = 'USER',
  /** Factories and free facilities — the factory app. */
  FACTORY = 'FACTORY',
}

/**
 * Tiers that make a material VISIBLE to an audience.
 *
 * Both tiers of an app, because each app serves two roles and a visitor does
 * not yet have one: a material priced only for institutions is a material an
 * institution can buy, and hiding it from the user app would hide it from
 * exactly the visitor it was priced for.
 *
 * Kept separate from what is QUOTED below. The two were one constant, and
 * narrowing it to trim the price sheet would silently have removed every
 * institution-only material from the visitor catalogue — a much larger change
 * than the one intended, and invisible from the payload.
 */
export const AUDIENCE_TIERS: Readonly<Record<GuestAudience, readonly PricingTier[]>> = {
  [GuestAudience.USER]: [PricingTier.INDIVIDUAL, PricingTier.COMPANY],
  [GuestAudience.FACTORY]: [PricingTier.FACTORY, PricingTier.FREE_FACILITY],
};

/**
 * Tiers whose PRICE is printed for each audience — ONE each.
 *
 * A visitor has no role yet, so two prices side by side is a question they
 * cannot answer, and the one they guess at is wrong about half the time. What
 * they are actually deciding is whether this is worth registering for, and a
 * single indicative number answers that.
 *
 * So each app quotes its PRIMARY tier: the user app quotes INDIVIDUAL, and the
 * factory app quotes FACTORY. The secondary role of each app — institutions,
 * free facilities — is quoted its own sheet everywhere, the moment it has an
 * account.
 *
 * The consequence is deliberate and worth naming: a free facility browsing as a
 * visitor is shown the factory price, which is not what it will be charged. The
 * MATERIAL still appears either way — that is what the separate visibility list
 * above protects, and it is the part that would have broken had these two lists
 * stayed one.
 */
export const AUDIENCE_QUOTED_TIERS: Readonly<
  Record<GuestAudience, readonly PricingTier[]>
> = {
  [GuestAudience.USER]: [PricingTier.INDIVIDUAL],
  [GuestAudience.FACTORY]: [PricingTier.FACTORY],
};

/**
 * Roles an audience's offers may target.
 *
 * An offer aimed at factories has no business appearing in the user app, and
 * vice versa: it would advertise a discount to visitors who can never claim it.
 */
export const AUDIENCE_ROLES: Readonly<Record<GuestAudience, readonly Role[]>> = {
  [GuestAudience.USER]: [Role.CITIZEN, Role.INSTITUTIONS],
  [GuestAudience.FACTORY]: [Role.FACTORY, Role.EXTERNAL_PARTNER],
};

/**
 * Tiers that are priced PER GRADE rather than with one flat number.
 *
 * A factory pays differently for EXCELLENT and DAMAGED of the same material; an
 * individual is paid one price whatever the state. Anything reading a price has
 * to know which of the two shapes it is looking at, and this is the one place
 * that says so.
 */
export const GRADED_TIERS: readonly PricingTier[] = [
  PricingTier.FACTORY,
  PricingTier.FREE_FACILITY,
];

export function isGradedTier(tier: PricingTier): boolean {
  return GRADED_TIERS.includes(tier);
}

/** Lower-case tier key used in JSON payloads (`individual`, `free_facility`, …). */
export function tierKey(tier: PricingTier): string {
  return tier.toLowerCase();
}
