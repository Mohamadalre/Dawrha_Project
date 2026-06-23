import { Role } from '@src/user/enums/role.enum';

/**
 * Pricing tiers used by the marketplace.
 * The prompt models three commercial tiers (individual / company / factory).
 * Free-facility (EXTERNAL_PARTNER) shares the FACTORY tier by default.
 */
export enum PricingTier {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
  FACTORY = 'FACTORY',
}

/**
 * Maps an authenticated account role to the pricing tier it should be charged at.
 */
export function tierForRole(role: Role): PricingTier {
  switch (role) {
    case Role.CITIZEN:
      return PricingTier.INDIVIDUAL;
    case Role.INSTITUTIONS:
      return PricingTier.COMPANY;
    case Role.FACTORY:
    case Role.EXTERNAL_PARTNER:
      return PricingTier.FACTORY;
    default:
      return PricingTier.INDIVIDUAL;
  }
}
