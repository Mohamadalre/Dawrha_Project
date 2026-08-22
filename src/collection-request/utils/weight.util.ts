import { Product } from '@src/waste-management/entities/product.entity';

/**
 * The payload a request puts on a truck, in kilograms:
 *  - a material with a unit weight (`unitWeightKg`) converts by that factor,
 *  - otherwise one unit IS one kilogram when the unit is a weight code,
 *  - anything else carries no kg estimate at all.
 */
export function estimateWeightKg(
  product: Product,
  quantity: number,
  weightCodes: Set<string>,
): number {
  if (product.unitWeightKg != null) {
    return +(quantity * Number(product.unitWeightKg)).toFixed(3);
  }
  if (weightCodes.has(product.unitType)) {
    return +quantity.toFixed(3);
  }
  return 0;
}
