import { Role } from '@src/user/enums/role.enum';

/**
 * How the buyer receives the goods.
 *
 * Factories and free facilities are treated identically everywhere EXCEPT
 * here: only a factory may ask for delivery. A free facility always collects
 * its own goods, which is also why splitting its order across warehouses is far
 * more costly to it — every extra part is another site it must drive to.
 */
export enum FulfilmentMode {
  DELIVERY = 'DELIVERY',
  PICKUP = 'PICKUP',
}

/** Roles allowed to choose DELIVERY. */
const DELIVERY_ELIGIBLE_ROLES: readonly Role[] = [Role.FACTORY];

export function canUseDelivery(role: Role): boolean {
  return DELIVERY_ELIGIBLE_ROLES.includes(role);
}

/**
 * The mode an order ends up with. A free facility asking for delivery is not
 * an error to throw at the buyer — the request simply cannot apply to them, so
 * it resolves to PICKUP rather than failing a checkout over a field they may
 * not even have seen.
 */
export function resolveFulfilmentMode(
  role: Role,
  requested: FulfilmentMode | undefined,
): FulfilmentMode {
  if (requested === FulfilmentMode.DELIVERY && canUseDelivery(role)) {
    return FulfilmentMode.DELIVERY;
  }
  return FulfilmentMode.PICKUP;
}
