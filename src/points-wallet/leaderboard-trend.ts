/**
 * The movement of one user on the leaderboard since the last daily snapshot.
 *
 * Pure and separately tested: given a current rank and the baseline rank it
 * returns the trend with no database, so the rule can be asserted with numbers.
 *
 * A LOWER rank number is a BETTER position (1st is the top), so:
 *   - current < previous  → the user CLIMBED   → UP
 *   - current > previous  → the user SLIPPED   → DOWN
 *   - current == previous → no movement        → SAME
 *   - no baseline yet (first snapshot)          → SAME (nothing to move from)
 */
export type LeaderboardTrend = 'UP' | 'DOWN' | 'SAME';

export interface TrendResult {
  trend: LeaderboardTrend;
  /**
   * How many places the user moved, POSITIVE for a climb and NEGATIVE for a
   * slip (0 when unchanged or no baseline). A place gained is `previous -
   * current`, so climbing from 5th to 2nd is +3.
   */
  rank_change: number;
}

export function deriveTrend(
  currentRank: number,
  previousRank: number | null | undefined,
): TrendResult {
  if (previousRank == null) return { trend: 'SAME', rank_change: 0 };
  const change = previousRank - currentRank; // + = climbed, - = slipped
  if (change > 0) return { trend: 'UP', rank_change: change };
  if (change < 0) return { trend: 'DOWN', rank_change: change };
  return { trend: 'SAME', rank_change: 0 };
}
