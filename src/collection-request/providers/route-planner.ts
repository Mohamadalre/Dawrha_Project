import { haversineKm } from '../utils/geo.util';

/**
 * One collector stop: a request's pickup, with its coordinate and — for
 * institutions — a fixed window. `scheduledAt` is null for IMMEDIATE requests.
 */
export interface RouteStop {
  requestId: string;
  lat: number;
  lng: number;
  scheduledAt: Date | null;
}

/** The knobs of a route's order and its merge rule, from dispatch_config. */
export interface RouteConstraints {
  /** Max travel-minutes gap between stops for two requests to share a route. */
  mergeMaxMinutes: number;
  /** Max straight-line km for the same. */
  mergeMaxKm: number;
  /** ± minutes an institution stop tolerates around its scheduled time. */
  institutionToleranceMin: number;
  /** City speed assumed for travel-time estimates (km/h). */
  avgSpeedKmh: number;
}

export const DEFAULT_ROUTE_CONSTRAINTS: RouteConstraints = {
  mergeMaxMinutes: 15,
  mergeMaxKm: 2,
  institutionToleranceMin: 20,
  avgSpeedKmh: 25,
};

export interface OrderedPlan {
  /** The stop ids in the order the driver should serve them. */
  stopIds: string[];
  /** Total road distance of the tour (straight-line sum). */
  distanceKm: number;
  /** False when the deadlines cannot ALL be met even flying in a straight line. */
  feasible: boolean;
  reason?: string;
}

export interface MergeVerdict {
  mergeable: boolean;
  /** Index within the `stops` array passed in (0-based) at which to insert. */
  position?: number;
  reason?: string;
}

/**
 * Travel minutes for a straight-line leg at the assumed city speed. A stop with
 * no coordinates contributes zero, which is the documented blind spot: a
 * coord-less stop can neither be planned against nor veto a merge.
 */
export function travelMinutes(km: number, speedKmh = DEFAULT_ROUTE_CONSTRAINTS.avgSpeedKmh): number {
  return (km / speedKmh) * 60;
}

/**
 * Plans a driver's tour: the pick order of the given stops.
 *
 * Pure: no database, no clock, no network — the caller hands in everything
 * (`now`, the origin, the constraints), so the same input always produces the
 * same order and tests need no fixtures. The rule is the classic deadline-aware
 * greedy: repeated nearest-neighbour, where picking the nearest stop is vetoed
 * whenever it would leave a scheduled (institution) stop unreachable inside its
 * tolerance window. That keeps immediate pickups merged into the tour without
 * ever delaying a fixed appointment past ±`institutionToleranceMin`.
 *
 * When `origin` is null the first leg counts as zero (the caller could not
 * say where the driver is) and the tour simply starts at the nearest pair.
 * Stops without coordinates are ordered last-to-first greedily without time
 * checks and never veto a pick.
 */
export function planRoute(params: {
  stops: RouteStop[];
  origin?: { lat: number; lng: number } | null;
  now: Date;
  constraints?: Partial<RouteConstraints>;
}): OrderedPlan {
  const { stops, origin, now } = params;
  const c: RouteConstraints = { ...DEFAULT_ROUTE_CONSTRAINTS, ...params.constraints };
  if (!stops.length) return { stopIds: [], distanceKm: 0, feasible: true };

  const tolMs = c.institutionToleranceMin * 60_000;
  const remaining = [...stops];
  const ordered: RouteStop[] = [];
  let current = origin ?? null;
  let cumKm = 0;
  let feasible = true;
  let reason: string | undefined;

  const distTo = (s: RouteStop): number =>
    current ? haversineKm(current.lat, current.lng, s.lat, s.lng) : 0;

  while (remaining.length) {
    const byDistance = [...remaining].sort((a, b) => distTo(a) - distTo(b));

    let picked = byDistance[0];
    if (current) {
      // Veto the nearest pick when it makes any scheduled stop unreachable in
      // time — even along the optimistic straight line through the picked stop.
      const afterPickKm = cumKm + distTo(byDistance[0]);
      const pickedId = byDistance[0].requestId;
      for (const s of byDistance) {
        if (s.requestId === pickedId || !s.scheduledAt) continue;
        const eta =
          now.getTime() + travelMinutes(afterPickKm + haversineKm(byDistance[0].lat, byDistance[0].lng, s.lat, s.lng), c.avgSpeedKmh) * 60_000;
        if (eta > s.scheduledAt.getTime() + tolMs) {
          picked = s;
          feasible = false;
          reason = `Deadline of ${s.requestId} cannot be met from the nearest stop`;
          break;
        }
      }
    }

    // The picked stop itself must be reachable in time.
    if (picked.scheduledAt && current) {
      const eta = now.getTime() + travelMinutes(cumKm + distTo(picked), c.avgSpeedKmh) * 60_000;
      if (eta > picked.scheduledAt.getTime() + tolMs) {
        feasible = false;
        reason = `Stop ${picked.requestId} is unreachable inside its tolerance window`;
      }
    }

    cumKm += distTo(picked);
    ordered.push(picked);
    remaining.splice(remaining.indexOf(picked), 1);
    current = { lat: picked.lat, lng: picked.lng };
  }

  return {
    stopIds: ordered.map((s) => s.requestId),
    distanceKm: round3(cumKm),
    feasible,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Can an incoming request join an ordered tour without breaking any scheduled
 * appointment? The merge rule from the design:
 *
 *   ≤ `mergeMaxKm` OR ≤ `mergeMaxMinutes` extra road on the inserted leg, AND
 *   the incoming stop (and every stop after it) still reaches its scheduled
 *   window (± `institutionToleranceMin`) when the driver keeps going from the
 *   last fully-done stop.
 *
 * The first position that satisfies both wins — v1 prefers the earliest
 * insertion (the driver picks the fresh request up on the way to what is
 * already planned). `position` is relative to the `stops` array passed in.
 */
export function canMergeInto(params: {
  /** The route's not-yet-done stops IN ORDER (the planned remainder). */
  stops: RouteStop[];
  /** The route's last fully-done stop (DELIVERED/COMPLETED/CANCELLED). */
  lastServed: RouteStop | null;
  incoming: RouteStop;
  now: Date;
  constraints?: Partial<RouteConstraints>;
}): MergeVerdict {
  const c: RouteConstraints = { ...DEFAULT_ROUTE_CONSTRAINTS, ...params.constraints };
  const { stops, lastServed, incoming, now } = params;
  const stopIds = new Set(stops.map((s) => s.requestId));
  if (stopIds.has(incoming.requestId)) {
    return { mergeable: false, reason: 'Already on this route' };
  }
  if (!lastServed) {
    if (!stops.length) return { mergeable: true, position: 0 };
    return { mergeable: false, reason: 'No served stop to merge from' };
  }
  const coordsOk = stops.every(
    (s) => s.lat != null && s.lng != null && !Number.isNaN(s.lat) && !Number.isNaN(s.lng),
  );
  if (!coordsOk) return { mergeable: false, reason: 'A stop on the route has no coordinates' };

  const tolMs = c.institutionToleranceMin * 60_000;

  // Every insertion index: position 0 = serve the incoming right after the
  // last-done stop, N = append at the end of the planned remainder.
  for (let p = 0; p <= stops.length; p++) {
    const before = p === 0 ? lastServed : stops[p - 1];
    const after = p === stops.length ? null : stops[p];
    const addedKm = after
      ? haversineKm(before.lat, before.lng, incoming.lat, incoming.lng) +
        haversineKm(incoming.lat, incoming.lng, after.lat, after.lng) -
        haversineKm(before.lat, before.lng, after.lat, after.lng)
      : haversineKm(before.lat, before.lng, incoming.lat, incoming.lng);

    const tooFar = addedKm > c.mergeMaxKm;
    const tooLong = travelMinutes(addedKm, c.avgSpeedKmh) > c.mergeMaxMinutes;
    if (tooFar && tooLong) continue;

    // Deadline feasibility of the whole remainder with the incoming inserted.
    const seq = [...stops.slice(0, p), incoming, ...stops.slice(p)];
    let cumKm = 0;
    let prev = lastServed;
    let ok = true;
    for (const s of seq) {
      cumKm += haversineKm(prev.lat, prev.lng, s.lat, s.lng);
      if (s.scheduledAt) {
        const eta = now.getTime() + travelMinutes(cumKm, c.avgSpeedKmh) * 60_000;
        if (eta > s.scheduledAt.getTime() + tolMs) {
          ok = false;
          break;
        }
      }
      prev = s;
    }
    if (!ok) continue;

    return { mergeable: true, position: p };
  }

  return { mergeable: false, reason: 'No insertion keeps the scheduled windows' };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}