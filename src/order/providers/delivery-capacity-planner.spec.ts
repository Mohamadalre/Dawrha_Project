import {
  PackablePart,
  planDeliveryTrips,
} from './delivery-capacity-planner';

const part = (
  partId: string,
  warehouseId: string,
  distanceToBuyerKm: number,
  weightKg: number,
): PackablePart => ({ partId, warehouseId, distanceToBuyerKm, weightKg });

// A fixed capacity for every warehouse, for the simple cases.
const flat = (kg: number) => () => kg;

describe('planDeliveryTrips', () => {
  it('puts the whole order on one truck when it all fits', () => {
    const trips = planDeliveryTrips(
      [
        part('p1', 'far', 40, 300),
        part('p2', 'mid', 25, 200),
        part('p3', 'near', 10, 100),
      ],
      flat(1000),
    );
    expect(trips).toHaveLength(1);
    // Farthest warehouse is where the truck sets out.
    expect(trips[0].startWarehouseId).toBe('far');
    expect(trips[0].parts.map((p) => p.partId)).toEqual(['p1', 'p2', 'p3']);
    expect(trips[0].totalWeightKg).toBe(600);
  });

  it('collects farthest first', () => {
    const trips = planDeliveryTrips(
      [
        part('near', 'wn', 10, 100),
        part('far', 'wf', 40, 100),
        part('mid', 'wm', 25, 100),
      ],
      flat(1000),
    );
    expect(trips[0].parts.map((p) => p.partId)).toEqual(['far', 'mid', 'near']);
  });

  it('spills the overflow onto the nearer warehouse’s own truck', () => {
    // Capacity 500. Far part is 400; mid part is 300 — together 700 > 500, so
    // mid cannot ride with far. Mid starts its own trip and picks up near.
    const trips = planDeliveryTrips(
      [
        part('far', 'wf', 40, 400),
        part('mid', 'wm', 25, 300),
        part('near', 'wn', 10, 150),
      ],
      flat(500),
    );
    expect(trips).toHaveLength(2);
    expect(trips[0].startWarehouseId).toBe('wf');
    expect(trips[0].parts.map((p) => p.partId)).toEqual(['far']);
    // Mid's truck sets out from mid and consolidates near (300 + 150 = 450 ≤ 500).
    expect(trips[1].startWarehouseId).toBe('wm');
    expect(trips[1].parts.map((p) => p.partId)).toEqual(['mid', 'near']);
    expect(trips[1].totalWeightKg).toBe(450);
  });

  it('keeps filling the first truck with nearer parts that still fit', () => {
    // Capacity 500. far=300, mid=300 (won't fit with far → own trip),
    // near=150 (fits on the FIRST truck: 300 + 150 = 450 ≤ 500).
    const trips = planDeliveryTrips(
      [
        part('far', 'wf', 40, 300),
        part('mid', 'wm', 25, 300),
        part('near', 'wn', 10, 150),
      ],
      flat(500),
    );
    expect(trips).toHaveLength(2);
    expect(trips[0].parts.map((p) => p.partId)).toEqual(['far', 'near']);
    expect(trips[1].parts.map((p) => p.partId)).toEqual(['mid']);
  });

  it('uses each start warehouse’s own truck capacity', () => {
    // Far warehouse has a small truck (300); the next has a big one (2000).
    const capacityByWarehouse: Record<string, number> = { wf: 300, wm: 2000 };
    const trips = planDeliveryTrips(
      [
        part('far', 'wf', 40, 300),
        part('mid', 'wm', 25, 500),
        part('near', 'wn', 10, 500),
      ],
      (wh) => capacityByWarehouse[wh] ?? 1000,
    );
    // far truck holds only its own 300; mid truck (2000) takes mid + near.
    expect(trips[0].parts.map((p) => p.partId)).toEqual(['far']);
    expect(trips[1].startWarehouseId).toBe('wm');
    expect(trips[1].parts.map((p) => p.partId)).toEqual(['mid', 'near']);
  });

  it('carries a single over-heavy part but flags it', () => {
    const trips = planDeliveryTrips(
      [part('huge', 'wf', 40, 1200)],
      flat(1000),
    );
    expect(trips).toHaveLength(1);
    expect(trips[0].parts.map((p) => p.partId)).toEqual(['huge']);
    expect(trips[0].overCapacity).toBe(true);
  });

  it('treats unknown capacity as unbounded (one truck)', () => {
    const trips = planDeliveryTrips(
      [
        part('far', 'wf', 40, 5000),
        part('near', 'wn', 10, 5000),
      ],
      () => 0,
    );
    expect(trips).toHaveLength(1);
    expect(trips[0].parts).toHaveLength(2);
  });
});
