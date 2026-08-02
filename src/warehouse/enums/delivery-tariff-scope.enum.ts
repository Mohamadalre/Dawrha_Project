/**
 * What a delivery tariff applies to. Mirrors `recycle.delivery.tariff.scope`.
 *
 * Resolution is most-specific-wins, and `SCOPE_SPECIFICITY` is the single place
 * that ordering is expressed — a sort key rather than a chain of if/else, so
 * adding a scope later means adding one entry, not editing branching logic.
 */
export enum DeliveryTariffScope {
  WAREHOUSE = 'WAREHOUSE',
  PROVINCE = 'PROVINCE',
  GLOBAL = 'GLOBAL',
}

/** Lower = more specific = wins. */
export const SCOPE_SPECIFICITY: Record<DeliveryTariffScope, number> = {
  [DeliveryTariffScope.WAREHOUSE]: 0,
  [DeliveryTariffScope.PROVINCE]: 1,
  [DeliveryTariffScope.GLOBAL]: 2,
};

/** Odoo writes lowercase keys ('warehouse'); this maps them onto the enum. */
export function tariffScopeFromOdoo(value: unknown): DeliveryTariffScope | null {
  const key = String(value ?? '').trim().toUpperCase();
  return (DeliveryTariffScope as Record<string, DeliveryTariffScope>)[key] ?? null;
}
