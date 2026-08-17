/**
 * Deciding how many trucks a split delivery needs, and which parts ride
 * together — by WEIGHT.
 *
 * The trip service used to refuse this and make the dispatcher group parts by
 * hand, for an honest reason at the time: truck capacity is kilograms, and the
 * catalogue measures some materials in pieces, so there was no way to weigh a
 * load. That reason is gone — every material now carries its weight per unit in
 * kilograms, so a part's weight is a sum, not a guess.
 *
 * The rule matches how the milk run actually drives. The truck sets out from the
 * FARTHEST warehouse and heads inward toward the buyer, picking up as it passes.
 * It takes each warehouse's part while there is room; the first part that will
 * not fit is left for its OWN warehouse to send on its own truck, which then
 * makes the same inward run for whatever is still unassigned. Every truck ends
 * at the buyer.
 *
 * Pure and deterministic: given the parts and a capacity per warehouse it
 * returns the same grouping every time, and it can be asserted with a few
 * numbers. Picking WHICH truck (and therefore the capacity) is the caller's
 * job — that needs the fleet and the score; this needs only kilograms.
 */
export interface PackablePart {
  partId: string;
  warehouseId: string;
  /** Distance from this part's warehouse to the buyer — the route ordering. */
  distanceToBuyerKm: number;
  /** The part's total weight in kilograms. */
  weightKg: number;
}

export interface PackedTrip {
  /** The farthest warehouse of this trip — where its truck sets out. */
  startWarehouseId: string;
  parts: PackablePart[];
  totalWeightKg: number;
  /**
   * True when a SINGLE part on its own already exceeds the truck's capacity.
   * The part is still carried (it has to go somewhere), but the caller should
   * surface it: one warehouse's share needing more than a full truck is a real
   * operational problem, not something to hide inside a rounding.
   */
  overCapacity: boolean;
}

const EPS = 0.0001;

/**
 * Groups parts into trips, farthest warehouse first, filling each truck to its
 * capacity before the overflow starts the next.
 *
 * `capacityForWarehouse` returns the payload ceiling (kg) of the truck that
 * would run from a given warehouse; a non-positive value means "unknown", and
 * is treated as unbounded so the planner still produces a grouping — the caller
 * is responsible for having checked a truck actually exists.
 */
export function planDeliveryTrips(
  parts: PackablePart[],
  capacityForWarehouse: (warehouseId: string) => number,
): PackedTrip[] {
  // Farthest from the buyer first — the order the truck collects in.
  let pool = [...parts].sort((a, b) => b.distanceToBuyerKm - a.distanceToBuyerKm);
  const trips: PackedTrip[] = [];

  while (pool.length) {
    const start = pool[0];
    const declared = capacityForWarehouse(start.warehouseId);
    const capacity = declared > 0 ? declared : Number.POSITIVE_INFINITY;

    const tripParts: PackablePart[] = [];
    const remaining: PackablePart[] = [];
    let load = 0;
    let overCapacity = false;

    for (const part of pool) {
      if (tripParts.length === 0) {
        // The farthest unassigned part always starts the trip — even if it
        // alone is too heavy, because it has to be carried by someone and its
        // own warehouse is where the truck is.
        tripParts.push(part);
        load = round3(load + part.weightKg);
        if (part.weightKg > capacity + EPS) overCapacity = true;
      } else if (round3(load + part.weightKg) <= capacity + EPS) {
        tripParts.push(part);
        load = round3(load + part.weightKg);
      } else {
        // No room — this warehouse sends it on its own truck, next loop.
        remaining.push(part);
      }
    }

    trips.push({
      startWarehouseId: start.warehouseId,
      parts: tripParts,
      totalWeightKg: load,
      overCapacity,
    });
    pool = remaining;
  }

  return trips;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
