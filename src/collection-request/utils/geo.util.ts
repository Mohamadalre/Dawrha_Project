/**
 * Earth-distance helpers for the dispatch election. Haversine over a sphere is
 * plenty for the few kilometres a collection route spans; nobody here needs
 * a geodesic library.
 */

const EARTH_RADIUS_KM = 6371;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres between two lat/lng pairs. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Initial bearing in degrees (0..360, clockwise from north) from point A to B.
 * Returns null only for a degenerate zero-length path.
 */
export function bearingBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number | null {
  if (!isFinite(lat1) || !isFinite(lng1) || !isFinite(lat2) || !isFinite(lng2)) {
    return null;
  }
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dLambda = toRadians(lng2 - lng1);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/** Signed difference between two headings, normalised to [0, 180]. */
export function headingDiffDeg(heading1: number, heading2: number): number {
  const diff = Math.abs((heading1 - heading2 + 360) % 360);
  return diff <= 180 ? diff : 360 - diff;
}