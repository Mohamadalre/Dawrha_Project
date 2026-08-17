/**
 * Choosing which of a warehouse's delivery trucks runs a trip.
 *
 * The dispatcher used to name the truck by hand, which quietly turned into
 * "whichever truck the dispatcher thinks of first" — the same two vehicles
 * running every route while the rest of the yard sat idle and wore unevenly.
 *
 * So the pick is a SCORE, and it balances two things the business asked for at
 * once:
 *
 *   CAPACITY — a bigger truck carries more of a split in one run, which is
 *   fewer trips and fewer drivers. Larger is better.
 *
 *   FAIRNESS — but "always the biggest" is how two trucks do all the work. A
 *   truck that has run many trips lately is pushed DOWN the ranking so the load
 *   rotates across the fleet and no vehicle is favoured into the ground.
 *
 * Pure and separately tested: the selection can be reasoned about and asserted
 * with a handful of numbers, no fixtures. Candidates are assumed already
 * filtered to trucks that MAY run — active, not disabled, not already on a live
 * trip — because "can this truck run at all" is a different question from "which
 * eligible truck is the best pick", and folding them together is how an
 * ineligible truck ends up scored and chosen.
 */
export interface ScorableTruck {
  odooTruckId: number;
  /** Payload ceiling in kg. Trucks with no declared capacity score lowest. */
  maxPayloadKg: number;
  /** Trips this truck ran in the fairness window — the rotation signal. */
  recentTripCount: number;
  /**
   * Does this truck have a driver who can actually run it right now — an active,
   * unblocked delivery driver bound to it in Odoo? Undefined is treated as
   * available (callers that do not know keep the old behaviour). A truck with no
   * driver is not refused outright — it is ranked BELOW every truck that has one,
   * so it is a last resort rather than a plan that silently stalls at dispatch.
   */
  hasAvailableDriver?: boolean;
}

export interface TruckScore {
  odooTruckId: number;
  score: number;
  capacityComponent: number;
  fairnessComponent: number;
  maxPayloadKg: number;
  recentTripCount: number;
  /** Whether this truck can carry the whole requested load in one trip. */
  fits: boolean;
  /** Whether a driver is available to run it (undefined input → true). */
  hasAvailableDriver: boolean;
}

export interface ScoreWeights {
  /** How much the capacity fit counts. */
  capacity: number;
  /** How much running fewer recent trips counts. */
  fairness: number;
}

export interface ScoreOptions {
  /**
   * The load this pick must carry, in kilograms. When given, the capacity term
   * becomes LOAD-AWARE: a truck that fits the load is preferred over one that
   * does not, and among trucks that fit the TIGHTEST is preferred (best fit) so
   * the big trucks are left free for the loads that actually need them — instead
   * of always tying up the largest vehicle for a 20 kg parcel. Omitted, capacity
   * falls back to "bigger is better" (fewer trips), the original behaviour.
   */
  requiredKg?: number;
  weights?: ScoreWeights;
}

export const DEFAULT_TRUCK_SCORE_WEIGHTS: ScoreWeights = {
  capacity: 0.5,
  fairness: 0.5,
};

/**
 * Scores every candidate, best first.
 *
 * One HARD rule, then a balanced score:
 *
 *   1. A truck with an AVAILABLE DRIVER outranks every truck without one — a
 *      truck whose driver is inactive or blocked cannot be sent, so it is a last
 *      resort, never a pick made over one that can actually run.
 *   2. Then the SCORE balances two things, neither forced:
 *        - capacity (load-aware): when a load is given, a truck that FITS it
 *          scores in the upper half and the TIGHTEST fit highest, so the big
 *          trucks are not tied up needlessly; a truck that cannot fit the whole
 *          load scores in the lower half by how much of it it can take. It is a
 *          preference, not a hard filter — fairness can still tip a close call.
 *        - fairness: the least-recently-used truck, so the fleet wears evenly.
 *   3. Ties fall to the larger truck, then the lower id, so the pick is
 *      deterministic and a test can assert one winner.
 */
export function scoreTrucks(
  candidates: ScorableTruck[],
  options: ScoreOptions | ScoreWeights = {},
): TruckScore[] {
  if (!candidates.length) return [];

  // Back-compat: an old caller passing bare weights still works.
  const opts: ScoreOptions =
    'capacity' in options && 'fairness' in options
      ? { weights: options as ScoreWeights }
      : (options as ScoreOptions);
  const weights = opts.weights ?? DEFAULT_TRUCK_SCORE_WEIGHTS;
  const requiredKg = opts.requiredKg;

  const maxCapacity = Math.max(...candidates.map((c) => Math.max(c.maxPayloadKg, 0)), 0);
  const maxUsage = Math.max(...candidates.map((c) => Math.max(c.recentTripCount, 0)), 0);

  const scored = candidates.map((c) => {
    const payload = Math.max(c.maxPayloadKg, 0);
    const fits = requiredKg != null && requiredKg > 0 ? payload >= requiredKg : true;

    // Load-aware capacity, with no hard tier: a truck that FITS the load lands in
    // the upper half [0.5, 1] — the tighter the fit the higher (best fit, so a
    // huge truck is not preferred for a small load) — while a truck that cannot
    // fit lands in the lower half [0, 0.5) by how much of the load it can carry.
    // So a fitting truck always scores at least as high on CAPACITY as a
    // non-fitting one, yet it is only a component: a much fresher truck can still
    // win on the whole score. With no load given, capacity is "bigger is better".
    let capacityComponent: number;
    if (requiredKg != null && requiredKg > 0) {
      capacityComponent = fits
        ? 0.5 + 0.5 * (requiredKg / payload)
        : 0.5 * (payload > 0 ? payload / requiredKg : 0);
    } else {
      capacityComponent = maxCapacity > 0 ? payload / maxCapacity : 0;
    }

    // Least-used earns 1, most-used earns 0. With no recent trips at all,
    // everyone is equally fresh, so fairness is neutral (1).
    const fairnessComponent =
      maxUsage > 0 ? (maxUsage - Math.max(c.recentTripCount, 0)) / maxUsage : 1;

    const score = round4(
      weights.capacity * capacityComponent + weights.fairness * fairnessComponent,
    );
    return {
      odooTruckId: c.odooTruckId,
      score,
      capacityComponent: round4(capacityComponent),
      fairnessComponent: round4(fairnessComponent),
      maxPayloadKg: c.maxPayloadKg,
      recentTripCount: c.recentTripCount,
      fits,
      // Undefined means "unknown" — treat as available, so a caller that does
      // not supply driver info keeps the plain capacity+fairness ordering.
      hasAvailableDriver: c.hasAvailableDriver !== false,
    };
  });

  return scored.sort(
    (a, b) =>
      // The one hard rule: a truck that can actually run (driver available).
      Number(b.hasAvailableDriver) - Number(a.hasAvailableDriver) ||
      // Then the balanced score: capacity fit (load-aware) + fairness.
      b.score - a.score ||
      // Deterministic tie-break.
      b.maxPayloadKg - a.maxPayloadKg ||
      a.odooTruckId - b.odooTruckId,
  );
}

/**
 * The single best truck, or null when none are eligible.
 *
 * `requiredKg` is an OPTIONAL preference, not a hard filter: on a milk run the
 * load is packed to whatever the chosen truck can take and the overflow starts
 * another truck, so a truck smaller than the whole load is still a valid pick —
 * it simply carries less. `scoreTrucks` now handles the fit as a ranking tier
 * (fitters ahead of non-fitters, best fit first) and driver availability ahead
 * of everything, so the top of its list is exactly this pick.
 */
export function pickBestDeliveryTruck(
  candidates: ScorableTruck[],
  requiredKg?: number,
  weights: ScoreWeights = DEFAULT_TRUCK_SCORE_WEIGHTS,
): TruckScore | null {
  if (!candidates.length) return null;
  return scoreTrucks(candidates, { requiredKg, weights })[0];
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
