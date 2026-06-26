import { Role } from '@src/user/enums/role.enum';

/**
 * Commercial pricing tiers. Every buyer role has its OWN tier / price:
 *   - INDIVIDUAL    → CITIZEN 
 *   - COMPANY       → INSTITUTIONS 
 *   - FACTORY       → FACTORY 
 *   - FREE_FACILITY → EXTERNAL_PARTNER 
 */
export enum PricingTier {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
  FACTORY = 'FACTORY',
  FREE_FACILITY = 'FREE_FACILITY',
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
      return PricingTier.FACTORY;
    case Role.EXTERNAL_PARTNER:
      return PricingTier.FREE_FACILITY;
    default:
      return PricingTier.INDIVIDUAL;
  }
}
