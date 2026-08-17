import {
  ScorableTruck,
  pickBestDeliveryTruck,
  scoreTrucks,
} from './truck-score';

const truck = (
  odooTruckId: number,
  maxPayloadKg: number,
  recentTripCount: number,
): ScorableTruck => ({ odooTruckId, maxPayloadKg, recentTripCount });

describe('scoreTrucks / pickBestDeliveryTruck', () => {
  it('prefers the larger truck when usage is equal', () => {
    const best = pickBestDeliveryTruck([
      truck(1, 1000, 2),
      truck(2, 3000, 2),
      truck(3, 2000, 2),
    ]);
    expect(best?.odooTruckId).toBe(2);
  });

  it('rotates away from a truck that has run many recent trips', () => {
    // Same capacity; truck 1 has been worked hard, truck 2 is fresh — fairness
    // sends the next trip to truck 2.
    const best = pickBestDeliveryTruck([
      truck(1, 2000, 9),
      truck(2, 2000, 0),
    ]);
    expect(best?.odooTruckId).toBe(2);
  });

  it('balances capacity against fairness rather than always taking the biggest', () => {
    // The big truck (1) has been used constantly; a slightly smaller but idle
    // truck (2) wins because the two goals are weighted together.
    const ranked = scoreTrucks([
      truck(1, 3000, 10),
      truck(2, 2500, 0),
    ]);
    expect(ranked[0].odooTruckId).toBe(2);
  });

  it('still takes the biggest when it is not the overworked one', () => {
    const best = pickBestDeliveryTruck([
      truck(1, 3000, 0),
      truck(2, 2500, 0),
    ]);
    expect(best?.odooTruckId).toBe(1);
  });

  it('prefers a truck that fits the whole load, all else equal', () => {
    // Both idle; only truck 1 fits 2800 kg whole, so it wins — one trip beats
    // two. Capacity is a strong preference when fairness does not disagree.
    const best = pickBestDeliveryTruck(
      [truck(1, 3000, 0), truck(2, 2000, 0)],
      2800,
    );
    expect(best?.odooTruckId).toBe(1);
  });

  it('lets fairness tip a close call away from an OVERWORKED fitting truck', () => {
    // Truck 1 fits 2800 but has run 5 recent trips; truck 2 does not fit but is
    // fresh. Capacity is a preference, NOT a hard rule, so the balanced score
    // rotates to the fresh truck — the fleet wears evenly, at the cost of a
    // second pickup. This is the whole point of not forcing the big truck.
    const best = pickBestDeliveryTruck(
      [truck(1, 3000, 5), truck(2, 2000, 0)],
      2800,
    );
    expect(best?.odooTruckId).toBe(2);
  });

  it('falls back to the score when no single truck fits the load', () => {
    // 5000 kg load, nothing fits it whole → the milk run will pack and spill,
    // so the fairest capable truck is chosen.
    const best = pickBestDeliveryTruck(
      [truck(1, 3000, 8), truck(2, 3000, 0)],
      5000,
    );
    expect(best?.odooTruckId).toBe(2);
  });

  it('ranks a truck WITH an available driver above one without, whatever the score', () => {
    // Truck 1 is bigger and idle (best on capacity+fairness) but has no driver;
    // truck 2 can actually run, so it wins. A truck that cannot move is never
    // preferred over one that can.
    const ranked = scoreTrucks([
      { odooTruckId: 1, maxPayloadKg: 5000, recentTripCount: 0, hasAvailableDriver: false },
      { odooTruckId: 2, maxPayloadKg: 800, recentTripCount: 3, hasAvailableDriver: true },
    ]);
    expect(ranked[0].odooTruckId).toBe(2);
    expect(ranked[1].odooTruckId).toBe(1);
  });

  it('best-fits the load: among trucks that fit, the tightest wins', () => {
    // 900 kg load. Trucks 950 and 5000 both fit; the tighter 950 is the pick,
    // leaving the 5000 free. The 500 truck cannot fit and ranks below both.
    const ranked = scoreTrucks(
      [truck(1, 5000, 0), truck(2, 950, 0), truck(3, 500, 0)],
      { requiredKg: 900 },
    );
    expect(ranked.map((r) => r.odooTruckId)).toEqual([2, 1, 3]);
    expect(ranked[0].fits).toBe(true);
    expect(ranked[2].fits).toBe(false);
  });

  it('is deterministic on a perfect tie (lowest id wins)', () => {
    const best = pickBestDeliveryTruck([
      truck(7, 2000, 1),
      truck(3, 2000, 1),
    ]);
    expect(best?.odooTruckId).toBe(3);
  });

  it('handles trucks with no declared capacity via the fairness term', () => {
    const best = pickBestDeliveryTruck([
      truck(1, 0, 4),
      truck(2, 0, 0),
    ]);
    expect(best?.odooTruckId).toBe(2);
  });

  it('returns null when there are no candidates', () => {
    expect(pickBestDeliveryTruck([])).toBeNull();
  });
});
