import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import { QUANTITY_EPSILON } from '../order.config';

/**
 * One material+grade the buyer asked for. `key` identifies it across
 * warehouses — two warehouses stocking the same grade of the same material
 * must answer to the same key.
 */
export interface RequiredLine {
  key: string;
  quantity: number;
}

/** What one warehouse can contribute, and how far away it is. */
export interface WarehouseSupply {
  warehouseId: string;
  distanceKm: number;
  /** key → quantity FREE right now (already net of other orders' holds). */
  available: Map<string, number>;
}

export interface PlannedLine {
  key: string;
  quantity: number;
}

export interface PlannedPart {
  warehouseId: string;
  distanceKm: number;
  lines: PlannedLine[];
}

export interface Shortfall {
  key: string;
  requested: number;
  allocated: number;
  missing: number;
}

export interface AllocationPlan {
  parts: PlannedPart[];
  shortfalls: Shortfall[];
  /** Total road distance of the chosen warehouses — the tie-breaker's value. */
  score: number;
  fullyCovered: boolean;
}

/**
 * Decides which warehouses fulfil an order.
 *
 * Pure: no database, no clock, no network. Everything it needs arrives as
 * arguments, which is what makes the decision reproducible and testable — you
 * can hand it a scenario and assert the plan, with no fixtures to stand up.
 *
 * The rule is a STRICT priority order, not a weighted score, because that is
 * what the business asked for and it is what can be explained to the buyer whose
 * order got split:
 *
 *   1. ONE warehouse if any single one can cover the whole order — the NEAREST
 *      such warehouse. A single warehouse is always preferred over a split, no
 *      matter how much nearer the split would be: one manager, one trip, one
 *      invoice.
 *   2. Otherwise the FEWEST warehouses that together cover it. Two beats three,
 *      three beats four, and so on — there is NO artificial cap on the number of
 *      warehouses: an order splits across as many as it takes to cover it.
 *      Delivery carries the extra trips, and a split PICKUP can be gathered into
 *      one warehouse by consolidation, so the old per-mode ceiling is gone.
 *   3. Among splits of that same fewest size, the one with the LEAST total road
 *      distance — the nearest set.
 *   4. If nothing can cover it even across every candidate, the best partial
 *      fill (nearest first), so the buyer can be shown exactly what is available
 *      and decide — the caller never ships short without asking.
 *
 * Enumerating combinations stays affordable because the candidate list is
 * already bounded upstream (the distance step keeps only the nearest handful,
 * MAX_CANDIDATE_WAREHOUSES): the number of subsets over a handful is tiny, so the
 * exact answer is cheaper than reasoning about a heuristic's blind spots.
 */
export function planAllocation(params: {
  required: RequiredLine[];
  supplies: WarehouseSupply[];
  /** Accepted for context; no longer bounds the split. */
  mode?: FulfilmentMode;
}): AllocationPlan {
  const { required } = params;
  // Nearest first — every step below relies on this ordering.
  const supplies = [...params.supplies].sort((a, b) => a.distanceKm - b.distanceKm);
  // No artificial cap: an order may split across as many warehouses as it needs
  // to be covered, bounded only by how many candidate warehouses there are.
  const maxParts = supplies.length;

  // 1. A single warehouse always wins if one can cover the whole order.
  const single = planSingleWarehouse(required, supplies);
  if (single) return single;

  // 2 & 3. The fewest warehouses that cover it, nearest set among equals.
  const split = planFewestParts(required, supplies, maxParts);
  if (split) return split;

  // 4. Nothing covers it within the ceiling — the best partial, to hand back.
  return planPartial(required, supplies, maxParts);
}

/**
 * The NEAREST single warehouse that can supply EVERY line on its own.
 *
 * `supplies` is nearest-first, so the first that covers is the nearest that
 * covers.
 */
function planSingleWarehouse(
  required: RequiredLine[],
  supplies: WarehouseSupply[],
): AllocationPlan | null {
  const covering = supplies.find((s) => combinationCovers(required, [s]));
  if (!covering) return null;

  const part: PlannedPart = {
    warehouseId: covering.warehouseId,
    distanceKm: covering.distanceKm,
    lines: required
      .filter((line) => line.quantity > QUANTITY_EPSILON)
      .map((line) => ({ key: line.key, quantity: round3(line.quantity) })),
  };
  return {
    parts: [part],
    shortfalls: [],
    score: round3(covering.distanceKm),
    fullyCovered: true,
  };
}

/**
 * The smallest set of warehouses that together cover the order, and — among
 * sets of that same smallest size — the one with the least total distance.
 *
 * Grown one size at a time from two upward: the first size that yields a
 * covering set is by construction the fewest possible, so the search stops the
 * moment it finds one.
 */
function planFewestParts(
  required: RequiredLine[],
  supplies: WarehouseSupply[],
  maxParts: number,
): AllocationPlan | null {
  for (let size = 2; size <= maxParts; size++) {
    let best: { combo: WarehouseSupply[]; totalKm: number } | null = null;
    for (const combo of combinations(supplies, size)) {
      if (!combinationCovers(required, combo)) continue;
      const totalKm = combo.reduce((sum, w) => sum + w.distanceKm, 0);
      if (!best || totalKm < best.totalKm) best = { combo, totalKm };
    }
    if (best) return buildCoveringPlan(required, best.combo);
  }
  return null;
}

/** Does this set of warehouses hold enough of EVERY line, added together? */
function combinationCovers(
  required: RequiredLine[],
  combo: WarehouseSupply[],
): boolean {
  return required.every((line) => {
    if (line.quantity <= QUANTITY_EPSILON) return true;
    const total = combo.reduce(
      (sum, w) => sum + (w.available.get(line.key) ?? 0),
      0,
    );
    return total >= line.quantity - QUANTITY_EPSILON;
  });
}

/**
 * Turns a covering set (already known to cover) into parts, filling nearest
 * first so the closest warehouse in the set carries as much as it can.
 *
 * `combo` is in nearest-first order (it was drawn from the sorted list), so a
 * warehouse can only end up with nothing if the ones before it already covered
 * everything — which cannot happen for a MINIMAL covering set, so no empty part
 * is produced. The filter is kept anyway as a cheap guarantee.
 */
function buildCoveringPlan(
  required: RequiredLine[],
  combo: WarehouseSupply[],
): AllocationPlan {
  const remaining = new Map(required.map((l) => [l.key, l.quantity]));
  const parts: PlannedPart[] = [];
  for (const supply of combo) {
    if (isSatisfied(remaining)) break;
    const lines = takeFrom(supply, remaining);
    if (!lines.length) continue;
    parts.push({
      warehouseId: supply.warehouseId,
      distanceKm: supply.distanceKm,
      lines,
    });
  }
  return {
    parts,
    shortfalls: buildShortfalls(required, remaining),
    score: round3(parts.reduce((sum, p) => sum + p.distanceKm, 0)),
    fullyCovered: true,
  };
}

/**
 * Best-effort fill when nothing can cover the order within the ceiling: take
 * from the nearest warehouses outward until the ceiling is reached, and report
 * what is still missing. This is what the buyer is shown so they can accept the
 * available quantity or walk away.
 */
function planPartial(
  required: RequiredLine[],
  supplies: WarehouseSupply[],
  maxParts: number,
): AllocationPlan {
  const remaining = new Map(required.map((l) => [l.key, l.quantity]));
  const parts: PlannedPart[] = [];
  for (const supply of supplies) {
    if (parts.length >= maxParts) break;
    if (isSatisfied(remaining)) break;
    const lines = takeFrom(supply, remaining);
    if (!lines.length) continue;
    parts.push({
      warehouseId: supply.warehouseId,
      distanceKm: supply.distanceKm,
      lines,
    });
  }
  const shortfalls = buildShortfalls(required, remaining);
  return {
    parts,
    shortfalls,
    score: round3(parts.reduce((sum, p) => sum + p.distanceKm, 0)),
    fullyCovered: shortfalls.length === 0,
  };
}

/** Takes what this warehouse can give, and decrements what is still needed. */
function takeFrom(
  supply: WarehouseSupply,
  remaining: Map<string, number>,
): PlannedLine[] {
  const lines: PlannedLine[] = [];
  for (const [key, needed] of remaining) {
    if (needed <= QUANTITY_EPSILON) continue;
    const free = supply.available.get(key) ?? 0;
    const take = Math.min(needed, free);
    if (take <= QUANTITY_EPSILON) continue;
    lines.push({ key, quantity: round3(take) });
    remaining.set(key, round3(needed - take));
  }
  return lines;
}

/** Every k-sized subset of `items`, preserving the input (nearest-first) order. */
function* combinations<T>(items: T[], k: number): Generator<T[]> {
  if (k <= 0 || k > items.length) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield indices.map((i) => items[i]);
    let pivot = k - 1;
    while (pivot >= 0 && indices[pivot] === items.length - k + pivot) pivot--;
    if (pivot < 0) return;
    indices[pivot]++;
    for (let i = pivot + 1; i < k; i++) indices[i] = indices[i - 1] + 1;
  }
}

function isSatisfied(remaining: Map<string, number>): boolean {
  for (const qty of remaining.values()) {
    if (qty > QUANTITY_EPSILON) return false;
  }
  return true;
}

function buildShortfalls(
  required: RequiredLine[],
  remaining: Map<string, number>,
): Shortfall[] {
  return required
    .map((line) => {
      const missing = remaining.get(line.key) ?? 0;
      return {
        key: line.key,
        requested: line.quantity,
        allocated: round3(line.quantity - missing),
        missing: round3(missing),
      };
    })
    .filter((s) => s.missing > QUANTITY_EPSILON);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One alternative set of warehouses the order could be split across instead. */
export interface CoveringOption {
  warehouseIds: string[];
  totalDistanceKm: number;
}

/**
 * The plan for a SPECIFIC set of warehouses the admin chose when modifying a
 * split — not the best set the allocator would pick, but exactly the one they
 * asked for. Returns null when a chosen warehouse is not a real candidate or the
 * chosen set does not cover the order (both a refusal, not a silent short-fill).
 */
export function planForWarehouses(params: {
  required: RequiredLine[];
  supplies: WarehouseSupply[];
  warehouseIds: string[];
}): AllocationPlan | null {
  const wanted = new Set(params.warehouseIds);
  const chosen = params.supplies.filter((s) => wanted.has(s.warehouseId));
  // Every chosen warehouse must be a real candidate, and together they must
  // cover the whole order — the admin cannot swap onto a set that falls short.
  if (chosen.length !== wanted.size) return null;
  if (!combinationCovers(params.required, chosen)) return null;
  return buildCoveringPlan(
    params.required,
    [...chosen].sort((a, b) => a.distanceKm - b.distanceKm),
  );
}

/**
 * Every set of EXACTLY `size` warehouses that TOGETHER cover the order, nearest
 * (least total road distance) first.
 *
 * This is the list an administrator is shown when they choose to MODIFY a split
 * they were handed: the same number of warehouses as the split itself (a
 * two-warehouse split offers other pairs, a three-warehouse split offers other
 * triples — never a different size), and only real options — a set is returned
 * only if it covers every line in full, and a warehouse that holds none of the
 * ordered materials is dropped before the enumeration so it is never offered.
 *
 * Bounded and cheap for the same reason allocation is: the candidate list is
 * already the nearest handful (MAX_CANDIDATE_WAREHOUSES), so the number of
 * `size`-sized subsets is tiny.
 */
export function coveringCombinations(params: {
  required: RequiredLine[];
  supplies: WarehouseSupply[];
  size: number;
}): CoveringOption[] {
  const { required, size } = params;

  // Drop warehouses that hold NONE of the ordered materials — they can never
  // contribute, so they must never appear in an option.
  const contributing = params.supplies.filter((s) =>
    required.some((l) => l.quantity > QUANTITY_EPSILON && (s.available.get(l.key) ?? 0) > QUANTITY_EPSILON),
  );
  const supplies = contributing.sort((a, b) => a.distanceKm - b.distanceKm);
  if (size < 1 || size > supplies.length) return [];

  const options: CoveringOption[] = [];
  for (const combo of combinations(supplies, size)) {
    if (!combinationCovers(required, combo)) continue;
    options.push({
      warehouseIds: combo.map((w) => w.warehouseId),
      totalDistanceKm: round3(combo.reduce((sum, w) => sum + w.distanceKm, 0)),
    });
  }
  return options.sort((a, b) => a.totalDistanceKm - b.totalDistanceKm);
}

/**
 * Fraction of the order that could NOT be filled — compared against the
 * partial-fulfilment tolerance to decide whether the buyer must be asked again.
 */
export function shortfallRatio(plan: AllocationPlan, required: RequiredLine[]): number {
  const total = required.reduce((sum, l) => sum + l.quantity, 0);
  if (total <= 0) return 0;
  const missing = plan.shortfalls.reduce((sum, s) => sum + s.missing, 0);
  return missing / total;
}
