/**
 * How a cached distance was produced.
 *
 * Recorded rather than assumed: a straight-line estimate and a real road
 * distance are not interchangeable, and the difference matters twice — a
 * delivery is priced per kilometre, and the warm-up job needs to know which
 * rows are still estimates so it can upgrade them once the provider is
 * reachable again.
 */
export enum DistanceSource {
  /**
   * Road distance from the Google Distance Matrix API — the real number, and
   * the one delivery is priced on.
   */
  GOOGLE = 'GOOGLE',
  /**
   * Great-circle distance computed in PostGIS from the stored coordinates.
   *
   * PROVISIONAL, never final. It exists so a checkout is never blocked by an
   * unreachable third party, but a straight line underestimates a real drive —
   * often badly in a city — so a row in this state is a promise to come back,
   * not an answer. The refresh sweep upgrades it as soon as Google responds.
   */
  HAVERSINE = 'HAVERSINE',
}

/**
 * Sources that still owe a real answer. Kept as a list so the refresh sweep
 * and any future source agree on what "not final yet" means.
 */
export const PROVISIONAL_SOURCES: readonly DistanceSource[] = [
  DistanceSource.HAVERSINE,
];

export function isProvisional(source: DistanceSource): boolean {
  return PROVISIONAL_SOURCES.includes(source);
}
