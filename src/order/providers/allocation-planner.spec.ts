import {
  AllocationPlan,
  RequiredLine,
  WarehouseSupply,
  coveringCombinations,
  planAllocation,
  planForWarehouses,
  shortfallRatio,
} from './allocation-planner';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';

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
  // ------------------------------------------------------------------
  // 1. A single covering warehouse is ALWAYS preferred
  // ------------------------------------------------------------------
  it('uses one warehouse when one can cover the whole order', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('near', 5, { 'PET:GOOD': 40 }),
        supply('far', 20, { 'PET:GOOD': 500 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    // 'near' cannot cover 100; 'far' can — so the nearest COVERING single wins.
    expect(ids(plan)).toEqual(['far']);
    expect(plan.fullyCovered).toBe(true);
    expect(plan.shortfalls).toHaveLength(0);
  });

  it('picks the NEAREST single warehouse among several that can cover', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('mid', 10, { 'PET:GOOD': 100 }),
        supply('near', 4, { 'PET:GOOD': 100 }),
        supply('far', 30, { 'PET:GOOD': 100 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(ids(plan)).toEqual(['near']);
  });

  it('prefers a single covering warehouse over splitting, however much nearer the split is', () => {
    // The single is far (90 km) and the split is right next door (2 + 3 km) —
    // but one warehouse means one manager, one trip, one invoice, so the rule
    // takes the single every time.
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('near-a', 2, { 'PET:GOOD': 50 }),
        supply('near-b', 3, { 'PET:GOOD': 50 }),
        supply('whole', 90, { 'PET:GOOD': 100 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(ids(plan)).toEqual(['whole']);
    expect(plan.fullyCovered).toBe(true);
  });

  it('applies the single-first rule identically for delivery and collection', () => {
    const supplies = [
      supply('near-a', 2, { 'PET:GOOD': 50 }),
      supply('near-b', 3, { 'PET:GOOD': 50 }),
      supply('whole', 40, { 'PET:GOOD': 100 }),
    ];
    const required = [line('PET:GOOD', 100)];

    const delivered = planAllocation({ required, supplies, mode: FulfilmentMode.DELIVERY });
    const collected = planAllocation({ required, supplies, mode: FulfilmentMode.PICKUP });

    expect(ids(delivered)).toEqual(['whole']);
    expect(ids(collected)).toEqual(['whole']);
  });

  // ------------------------------------------------------------------
  // 2 & 3. Fewest warehouses, then the nearest set among equals
  // ------------------------------------------------------------------
  it('splits only when NO single warehouse can cover the order', () => {
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

  it('uses the FEWEST warehouses even when more, nearer ones exist', () => {
    // A two-way split {a,b} covers; there is also a three-way {a,c,d} of nearer
    // warehouses — but two beats three, so the two-way plan wins.
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('a', 1, { 'PET:GOOD': 50 }),
        supply('c', 2, { 'PET:GOOD': 25 }),
        supply('d', 3, { 'PET:GOOD': 25 }),
        supply('b', 8, { 'PET:GOOD': 50 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.parts).toHaveLength(2);
    expect(ids(plan).sort()).toEqual(['a', 'b']);
  });

  it('among equal-size splits, chooses the nearest set', () => {
    // Every pair of {w1,w2,w3} covers 100 (each holds 50). The nearest PAIR is
    // {w1,w2} (1+2 km) — not {w1,w3} (1+9) or {w2,w3} (2+9).
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('w1', 1, { 'PET:GOOD': 50 }),
        supply('w2', 2, { 'PET:GOOD': 50 }),
        supply('w3', 9, { 'PET:GOOD': 50 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.parts).toHaveLength(2);
    expect(ids(plan).sort()).toEqual(['w1', 'w2']);
  });

  it('splits across three warehouses when two cannot cover it', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('a', 2, { 'PET:GOOD': 40 }),
        supply('b', 4, { 'PET:GOOD': 40 }),
        supply('c', 6, { 'PET:GOOD': 40 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.parts).toHaveLength(3);
    expect(plan.fullyCovered).toBe(true);
  });

  it('splits across as many warehouses as it takes — no artificial cap', () => {
    // Four warehouses each holding a quarter: the order needs all four, and with
    // the per-mode ceiling gone it gets all four and is fully covered. (Under the
    // old pickup cap of two this same order was reported 50 short.)
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

    expect(plan.parts).toHaveLength(4);
    expect(plan.fullyCovered).toBe(true);
  });

  it('the mode no longer changes how many warehouses an order may split across', () => {
    const supplies = [
      supply('a', 2, { 'PET:GOOD': 40 }),
      supply('b', 4, { 'PET:GOOD': 40 }),
      supply('c', 6, { 'PET:GOOD': 40 }),
    ];
    const required = [line('PET:GOOD', 100)];

    const delivered = planAllocation({ required, supplies, mode: FulfilmentMode.DELIVERY });
    const collected = planAllocation({ required, supplies, mode: FulfilmentMode.PICKUP });

    // Both split three ways and cover fully: the cap that once held pickup to two
    // is gone (a split pickup is now made whole by consolidation instead).
    expect(delivered.parts).toHaveLength(3);
    expect(delivered.fullyCovered).toBe(true);
    expect(collected.parts).toHaveLength(3);
    expect(collected.fullyCovered).toBe(true);
  });

  // ------------------------------------------------------------------
  // 4. Partial — reported, never shipped silently
  // ------------------------------------------------------------------
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
    // No single warehouse has both materials, so the fewest-covering set is the
    // pair — one per material.
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

  it('prefers a single warehouse that has BOTH materials over a split', () => {
    const plan = planAllocation({
      required: [line('PET:GOOD', 100), line('ALU:GOOD', 30)],
      supplies: [
        supply('split-a', 1, { 'PET:GOOD': 100 }),
        supply('split-b', 2, { 'ALU:GOOD': 30 }),
        supply('both', 25, { 'PET:GOOD': 100, 'ALU:GOOD': 30 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(ids(plan)).toEqual(['both']);
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
    // The nearest warehouse alone cannot finish the order; the pair can.
    const plan = planAllocation({
      required: [line('PET:GOOD', 100)],
      supplies: [
        supply('near', 1, { 'PET:GOOD': 99 }),
        supply('far', 70, { 'PET:GOOD': 1 }),
      ],
      mode: FulfilmentMode.DELIVERY,
    });

    expect(plan.fullyCovered).toBe(true);
    expect(ids(plan).sort()).toEqual(['far', 'near']);
  });
});

describe('coveringCombinations (admin "modify a split" alternatives)', () => {
  it('returns every SAME-SIZE covering set, nearest total distance first', () => {
    // Order needs 100 of PET. Pairs {a,b}=40+40, {a,c}=40+60, {b,c}=40+60 all
    // cover; {a,b} is nearest. A single warehouse is never offered (size is 2).
    const opts = coveringCombinations({
      required: [line('PET:GOOD', 80)],
      supplies: [
        supply('a', 2, { 'PET:GOOD': 40 }),
        supply('b', 4, { 'PET:GOOD': 40 }),
        supply('c', 6, { 'PET:GOOD': 60 }),
      ],
      size: 2,
    });

    expect(opts.map((o) => o.warehouseIds.sort().join('+'))).toEqual([
      'a+b', // 2+4 = 6 km
      'a+c', // 2+6 = 8 km
      'b+c', // 4+6 = 10 km
    ]);
    expect(opts[0].totalDistanceKm).toBe(6);
  });

  it('never offers a warehouse that holds none of the order, nor a different size', () => {
    const opts = coveringCombinations({
      required: [line('PET:GOOD', 80)],
      supplies: [
        supply('a', 2, { 'PET:GOOD': 40 }),
        supply('b', 4, { 'PET:GOOD': 40 }),
        supply('empty', 1, { 'OTHER:GOOD': 999 }), // holds none of the order
      ],
      size: 2,
    });

    // Only {a,b} covers; the empty warehouse is dropped before enumeration.
    expect(opts).toHaveLength(1);
    expect(opts[0].warehouseIds.sort()).toEqual(['a', 'b']);
  });

  it('offers triples when the split was across three warehouses', () => {
    const opts = coveringCombinations({
      required: [line('PET:GOOD', 90)],
      supplies: [
        supply('a', 1, { 'PET:GOOD': 30 }),
        supply('b', 2, { 'PET:GOOD': 30 }),
        supply('c', 3, { 'PET:GOOD': 30 }),
        supply('d', 4, { 'PET:GOOD': 30 }),
      ],
      size: 3,
    });

    // Every 3-of-4 subset totals 90 and covers; nearest set first.
    expect(opts).toHaveLength(4);
    expect(opts[0].warehouseIds.sort()).toEqual(['a', 'b', 'c']); // 1+2+3 = 6 km
    expect(opts.every((o) => o.warehouseIds.length === 3)).toBe(true);
  });
});

describe('planForWarehouses (apply an admin\'s chosen set)', () => {
  it('builds a plan on the EXACT warehouses chosen, filling nearest first', () => {
    const plan = planForWarehouses({
      required: [line('PET:GOOD', 80)],
      supplies: [
        supply('a', 2, { 'PET:GOOD': 40 }),
        supply('b', 4, { 'PET:GOOD': 40 }),
        supply('c', 6, { 'PET:GOOD': 60 }),
      ],
      warehouseIds: ['a', 'c'],
    })!;

    expect(ids(plan).sort()).toEqual(['a', 'c']);
    expect(plan.fullyCovered).toBe(true);
    // Nearest (a) fills as much as it can (40), c covers the rest (40).
    expect(qtyFor(plan, 'a', 'PET:GOOD')).toBe(40);
    expect(qtyFor(plan, 'c', 'PET:GOOD')).toBe(40);
  });

  it('refuses a chosen set that cannot cover the order', () => {
    const plan = planForWarehouses({
      required: [line('PET:GOOD', 200)],
      supplies: [
        supply('a', 2, { 'PET:GOOD': 40 }),
        supply('b', 4, { 'PET:GOOD': 40 }),
      ],
      warehouseIds: ['a', 'b'], // 80 < 200
    });
    expect(plan).toBeNull();
  });

  it('refuses when a chosen warehouse is not a candidate', () => {
    const plan = planForWarehouses({
      required: [line('PET:GOOD', 40)],
      supplies: [supply('a', 2, { 'PET:GOOD': 40 })],
      warehouseIds: ['a', 'ghost'],
    });
    expect(plan).toBeNull();
  });
});
