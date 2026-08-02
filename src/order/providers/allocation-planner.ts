import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import {
  MAX_PARTS_BY_MODE,
  QUANTITY_EPSILON,
  SPLIT_PENALTY_KM,
} from '../order.config';

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
  /** Distance plus the split penalty — the number plans are compared on. */
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
 * The method is deliberately simple, and that is a design choice rather than a
 * shortcut. It builds exactly TWO candidate plans and compares them:
 *
 *   1. the nearest single warehouse that can cover the whole order;
 *   2. a nearest-first fill across several warehouses.
 *
 * A general optimiser over every subset would be exponential, would need a
 * solver, and would produce answers nobody could explain to the buyer whose
 * order got split. Two candidates and one comparison capture the real trade-off
 * and can be justified in a sentence.
 */
export function planAllocation(params: {
  required: RequiredLine[];
  supplies: WarehouseSupply[];
  mode: FulfilmentMode;
}): AllocationPlan {
  const { required, mode } = params;
  // Nearest first — every strategy below relies on this ordering.
  const supplies = [...params.supplies].sort((a, b) => a.distanceKm - b.distanceKm);
  const maxParts = MAX_PARTS_BY_MODE[mode];

  const single = planSingleWarehouse(required, supplies, mode);
  const split = planNearestFirst(required, supplies, maxParts, mode);

  // A plan that covers the order always beats one that does not, however
  // cheaply it scores — a cheap plan that leaves the buyer short is not a
  // better outcome, it is a different (worse) one.
  const candidates = [single, split].filter((p): p is AllocationPlan => p !== null);
  if (!candidates.length) return emptyPlan(required);

  const covering = candidates.filter((p) => p.fullyCovered);
  const pool = covering.length ? covering : candidates;
  return pool.reduce((best, p) => (p.score < best.score ? p : best));
}

/**
 * The nearest warehouse that can supply EVERY line on its own.
 *
 * Tried first because one warehouse is nearly always the better outcome: one
 * manager to approve, one trip, one invoice. The scoring below only overrides
 * that when the single option is genuinely far.
 */
function planSingleWarehouse(
  required: RequiredLine[],
  supplies: WarehouseSupply[],
  mode: FulfilmentMode,
): AllocationPlan | null {
  const covering = supplies.find((s) =>
    required.every((line) => (s.available.get(line.key) ?? 0) >= line.quantity - QUANTITY_EPSILON),
  );
  if (!covering) return null;

  const part: PlannedPart = {
    warehouseId: covering.warehouseId,
    distanceKm: covering.distanceKm,
    lines: required.map((line) => ({ key: line.key, quantity: line.quantity })),
  };
  return {
    parts: [part],
    shortfalls: [],
    score: scorePlan([part], mode),
    fullyCovered: true,
  };
}

/**
 * Fill from the nearest warehouses outward, each taking what it can, until the
 * order is covered or the part ceiling is reached.
 *
 * One pass over the warehouses with an inner pass over the lines: the work is
 * bounded by candidates × lines, both small, and there is no backtracking to
 * reason about.
 */
function planNearestFirst(
  required: RequiredLine[],
  supplies: WarehouseSupply[],
  maxParts: number,
  mode: FulfilmentMode,
): AllocationPlan | null {
  const remaining = new Map(required.map((l) => [l.key, l.quantity]));
  const parts: PlannedPart[] = [];

  for (const supply of supplies) {
    if (parts.length >= maxParts) break;
    if (isSatisfied(remaining)) break;

    const lines = takeFrom(supply, remaining);
    if (!lines.length) continue; // this warehouse has nothing we still need

    parts.push({
      warehouseId: supply.warehouseId,
      distanceKm: supply.distanceKm,
      lines,
    });
  }

  if (!parts.length) return null;

  const shortfalls = buildShortfalls(required, remaining);
  return {
    parts,
    shortfalls,
    score: scorePlan(parts, mode),
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

/**
 * Distance plus a penalty per EXTRA warehouse.
 *
 * The penalty is what stops the planner splitting an order across three nearby
 * warehouses when one slightly farther warehouse could serve it whole. Every
 * extra part means another manager who must approve, another chance of
 * refusal, another invoice — real costs that distance alone does not express.
 * It is far heavier for self-collection, because there the BUYER makes each
 * extra trip.
 */
function scorePlan(parts: PlannedPart[], mode: FulfilmentMode): number {
  const distance = parts.reduce((sum, p) => sum + p.distanceKm, 0);
  const penalty = Math.max(parts.length - 1, 0) * SPLIT_PENALTY_KM[mode];
  return round3(distance + penalty);
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

function emptyPlan(required: RequiredLine[]): AllocationPlan {
  return {
    parts: [],
    shortfalls: required.map((l) => ({
      key: l.key,
      requested: l.quantity,
      allocated: 0,
      missing: l.quantity,
    })),
    score: Number.POSITIVE_INFINITY,
    fullyCovered: false,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
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
