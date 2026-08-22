import {
  DEFAULT_ROUTE_CONSTRAINTS,
  canMergeInto,
  planRoute,
  travelMinutes,
} from './route-planner';

describe('travelMinutes', () => {
  it('converts km at the assumed city speed', () => {
    expect(travelMinutes(25, 25)).toBeCloseTo(60, 6);
  });

  it('defaults to the route planner speed', () => {
    expect(travelMinutes(25)).toBeCloseTo(
      travelMinutes(25, DEFAULT_ROUTE_CONSTRAINTS.avgSpeedKmh),
      6,
    );
  });
});

describe('planRoute', () => {
  const now = new Date('2026-08-17T08:00:00Z');

  it('returns an empty tour for no stops', () => {
    expect(planRoute({ stops: [], now })).toEqual({
      stopIds: [],
      distanceKm: 0,
      feasible: true,
    });
  });

  it('orders a single stop first', () => {
    const stop = { requestId: 'a', lat: 33.5, lng: 36.2, scheduledAt: null };
    const plan = planRoute({ stops: [stop], now });
    expect(plan.stopIds).toEqual(['a']);
    expect(plan.feasible).toBe(true);
  });

  it('serves the nearest stop first', () => {
    const stops = [
      { requestId: 'far', lat: 33.5, lng: 37.0, scheduledAt: null },
      { requestId: 'near', lat: 33.501, lng: 36.201, scheduledAt: null },
    ];
    const plan = planRoute({
      stops,
      origin: { lat: 33.5, lng: 36.2 },
      now,
    });
    expect(plan.stopIds).toEqual(['near', 'far']);
  });

  it('vetoes the nearest pick when a scheduled stop would miss its window', () => {
    const tight = { institutionToleranceMin: 0 } as const;
    // A is the nearest stop (0.72 km out) but sits slightly OFF the direct
    // line to B (1.33 km out): serving A first makes B's arrival 3.9 minutes
    // away while B's window allows 3.5 — so the planner skips A, picks B.
    const stops = [
      { requestId: 'a', lat: 33.505, lng: 36.205, scheduledAt: null },
      {
        requestId: 'b',
        lat: 33.512,
        lng: 36.2,
        scheduledAt: new Date(now.getTime() + 3.5 * 60_000),
      },
    ];
    const plan = planRoute({
      stops,
      origin: { lat: 33.5, lng: 36.2 },
      now,
      constraints: { ...tight, avgSpeedKmh: 25 },
    });
    expect(plan.stopIds).toEqual(['b', 'a']);
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toMatch(/cannot be met/);
  });

  it('flags a scheduled stop that is unreachable even in a straight line', () => {
    const plan = planRoute({
      stops: [
        {
          requestId: 'late',
          lat: 33.7,
          lng: 36.2,
          scheduledAt: new Date(now.getTime() + 2 * 60_000),
        },
      ],
      origin: { lat: 33.5, lng: 36.2 },
      now,
      constraints: { institutionToleranceMin: 0, avgSpeedKmh: 25 },
    });
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toMatch(/unreachable/);
  });
});

describe('canMergeInto', () => {
  const now = new Date('2026-08-17T08:00:00Z');
  const lastServed = { requestId: 'done', lat: 33.5, lng: 36.2, scheduledAt: null };
  const incoming = { requestId: 'new', lat: 33.505, lng: 36.205, scheduledAt: null };

  it('accepts an incoming stop on an empty tour', () => {
    expect(canMergeInto({ stops: [], lastServed: null, incoming, now })).toEqual({
      mergeable: true,
      position: 0,
    });
  });

  it('refuses a stop already on the route', () => {
    const verdict = canMergeInto({
      stops: [{ ...incoming, scheduledAt: null }],
      lastServed,
      incoming,
      now,
    });
    expect(verdict.mergeable).toBe(false);
  });

  it('inserts a near stop at the first feasible position', () => {
    const stop = { requestId: 's1', lat: 33.51, lng: 36.2, scheduledAt: null };
    const verdict = canMergeInto({ stops: [stop], lastServed, incoming, now });
    expect(verdict.mergeable).toBe(true);
    expect(verdict.position).toBe(0);
  });

  it('rejects a stop that is beyond both the km and the minute limits', () => {
    const far = { requestId: 'far', lat: 33.9, lng: 36.2, scheduledAt: null };
    const verdict = canMergeInto({ stops: [far], lastServed, incoming: far, now });
    expect(verdict.mergeable).toBe(false);
  });

  it('rejects when a scheduled stop would slip past its tolerance', () => {
    const scheduled = {
      requestId: 's1',
      lat: 33.51,
      lng: 36.2,
      scheduledAt: new Date(now.getTime() + 1 * 60_000),
    };
    const verdict = canMergeInto({
      stops: [scheduled],
      lastServed,
      incoming: { ...incoming, lat: 33.52, lng: 36.21 },
      now,
      constraints: { institutionToleranceMin: 0 },
    });
    expect(verdict.mergeable).toBe(false);
  });

  it('refuses when a route stop has no coordinates', () => {
    const coordless = { requestId: 'c1', lat: 0, lng: 0, scheduledAt: null };
    const verdict = canMergeInto({
      stops: [{ ...coordless, lat: Number.NaN, lng: Number.NaN }],
      lastServed,
      incoming,
      now,
    });
    expect(verdict.mergeable).toBe(false);
  });
});
