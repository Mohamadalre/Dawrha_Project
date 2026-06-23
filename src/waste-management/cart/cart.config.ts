import { Role } from '@src/user/enums/role.enum';

/**
 * Cart business rules per buyer role.
 * - `minQuantity`: minimum total units required before checkout is allowed.
 * - `dailyMax`: maximum total units that may be added in a single day
 *               (`null` = unlimited; companies/factories have no daily cap).
 */
export interface CartLimits {
  minQuantity: number;
  dailyMax: number | null;
}

export const CART_LIMITS: Record<Role, CartLimits> = {
  [Role.CITIZEN]: { minQuantity: 1, dailyMax: 100 },
  [Role.INSTITUTIONS]: { minQuantity: 10, dailyMax: null },
  [Role.FACTORY]: { minQuantity: 50, dailyMax: null },
  [Role.EXTERNAL_PARTNER]: { minQuantity: 50, dailyMax: null },
  [Role.COLLECTOR]: { minQuantity: 1, dailyMax: null },
  [Role.ADMIN]: { minQuantity: 1, dailyMax: null },
};

export function cartLimitsFor(role: Role): CartLimits {
  return CART_LIMITS[role] ?? { minQuantity: 1, dailyMax: null };
}
