import {
  AllocationPlan,
  RequiredLine,
  WarehouseSupply,
  planAllocation,
  shortfallRatio,
} from './allocation-planner';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import { SPLIT_PENALTY_KM } from '../order.config';

const supply = (
  warehouseId: string,
  distanceKm: number,
  available: Record<string, number>,
): WarehouseSupply => ({
  warehouseId,
  distanceKm,
  available: new Map(Object.entries(available)),
});

const line = (key: string, quantity: number): RequiredLine => ({ key, quantity });
const ids = (plan: AllocationPlan) => plan.parts.map((p) => p.warehouseId);
const qtyFor = (plan: AllocationPlan, warehouseId: string, key: string) =>
  plan.parts
    .find((p) => p.warehouseId === warehouseId)
    ?.lines.find((l) => l.key === key)?.quantity ?? 0;

describe('planAllocation', () => {
  it('uses one warehouse when one can cover the whole order', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('near', 5, { 'PET:GOOD': 40 }),
        supply('far', 20, { 'PET:GOOD': 500 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(ids(plan)).toEqual(['far']);
    expect(plan.fullyCovered).toBe(true);
    expect(plan.shortfalls).toHaveLength(0);
  });

  it('prefers ONE farther warehouse over splitting across two nearer ones', () => {
    // Splitting would cost 4 + 6 = 10 km of travel against the single
    // warehouse's 18 — but the split penalty (15 km for delivery) makes the
    // single warehouse the better plan, which is the whole point of the rule.
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('near-a', 4, { 'PET:GOOD': 50 }),
        supply('near-b', 6, { 'PET:GOOD': 50 }),
        supply('whole', 18, { 'PET:GOOD': 100 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(ids(plan)).toEqual(['whole']);
  });

  it('does split when the single option is far enough to outweigh the penalty', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('near-a', 2, { 'PET:GOOD': 50 }),
        supply('near-b', 3, { 'PET:GOOD': 50 }),
        supply('whole', 90, { 'PET:GOOD': 100 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(ids(plan)).toEqual(['near-a', 'near-b']);
    expect(plan.fullyCovered).toBe(true);
  });

  it('splits when NO single warehouse can cover the order', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('a', 5, { 'PET:GOOD': 60 }),
        supply('b', 9, { 'PET:GOOD': 60 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(ids(plan)).toEqual(['a', 'b']);
    expect(qtyFor(plan, 'a', 'PET:GOOD')).toBe(60);
    expect(qtyFor(plan, 'b', 'PET:GOOD')).toBe(40);
    expect(plan.fullyCovered).toBe(true);
  });

  it('is far more reluctant to split for self-collection than for delivery', () => {
    // Identical supply; only the mode differs. With delivery the company
    // absorbs the extra trip, so splitting is acceptable. With collection the
    // BUYER drives to each site, so the single warehouse wins.
    const supplies = [
      supply('near-a', 2, { 'PET:GOOD': 50 }),
      supply('near-b', 3, { 'PET:GOOD': 50 }),
      supply('whole', 40, { 'PET:GOOD': 100 }),
    ];
    const required = [line('PET:GOOD', 100)];

    const delivered = planAllocation({ required, supplies, mode: FulfilmentMode.DELIVERY });
    const collected = planAllocation({ required, supplies, mode: FulfilmentMode.PICKUP });

    expect(ids(delivered)).toEqual(['near-a', 'near-b']);
    expect(ids(collected)).toEqual(['whole']);
    expect(SPLIT_PENALTY_KM[FulfilmentMode.PICKUP]).toBeGreaterThan(
      SPLIT_PENALTY_KM[FulfilmentMode.DELIVERY],
    );
  });

  it('never exceeds the part ceiling for the mode', () => {
    // Four warehouses each holding a quarter; collection allows at most two.
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('a', 1, { 'PET:GOOD': 25 }),
        supply('b', 2, { 'PET:GOOD': 25 }),
        supply('c', 3, { 'PET:GOOD': 25 }),
        supply('d', 4, { 'PET:GOOD': 25 }),
      ],
      mode: FulfilmentMode.PICKUP,
    });

    expect(plan.parts).toHaveLength(2);
    expect(plan.fullyCovered).toBe(false);
    expect(plan.shortfalls[0].missing).toBe(50);
  });

  it('reports what is missing instead of silently shipping short', () => {
    const required = [line('PET:GOOD', 100)];
    const plan = planAllocation({
      required,
      supplies: [supply('a', 5, { 'PET:GOOD': 96 })],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.fullyCovered).toBe(false);
    expect(plan.shortfalls).toEqual([
      { key: 'PET:GOOD', requested: 100, allocated: 96, missing: 4 },
    ]);
    expect(shortfallRatio(plan, required)).toBeCloseTo(0.04);
  });

  it('never lets one grade satisfy another', () => {
    // Plenty of GOOD in stock, but the order asked for EXCELLENT.
    const plan = planAllocation({
      required: [line('PET:EXCELLENT', 50)],
      supplies: [supply('a', 5, { 'PET:GOOD': 999 })],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.parts).toHaveLength(0);
    expect(plan.fullyCovered).toBe(false);
    expect(plan.shortfalls[0].missing).toBe(50);
  });

  it('covers a multi-material order across warehouses', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 100), line('ALU:GOOD', 30)],
      supplies: [
        supply('a', 3, { 'PET:GOOD': 100 }),
        supply('b', 8, { 'ALU:GOOD': 30 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.fullyCovered).toBe(true);
    expect(qtyFor(plan, 'a', 'PET:GOOD')).toBe(100);
    expect(qtyFor(plan, 'b', 'ALU:GOOD')).toBe(30);
  });

  it('returns an empty plan when nothing is available at all', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 10)],
      supplies: [],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.parts).toHaveLength(0);
    expect(plan.fullyCovered).toBe(false);
    expect(plan.shortfalls[0].missing).toBe(10);
  });

  it('skips warehouses that hold nothing the order still needs', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 50)],
      supplies: [
        supply('irrelevant', 1, { 'ALU:GOOD': 999 }),
        supply('useful', 12, { 'PET:GOOD': 50 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(ids(plan)).toEqual(['useful']);
  });

  it('prefers a covering plan over a cheaper one that leaves the buyer short', () => {
    // The nearest warehouse alone scores better, but cannot finish the order.
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('near', 1, { 'PET:GOOD': 99 }),
        supply('far', 70, { 'PET:GOOD': 1 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.fullyCovered).toBe(true);
    expect(ids(plan)).toEqual(['near', 'far']);
  });
});
