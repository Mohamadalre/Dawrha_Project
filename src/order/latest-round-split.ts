/** The one fact needed to tell a split from a single: which round, which part. */
export interface RoundOffer {
  roundNumber: number;
  partId: string;
}

/**
 * Was the order's MOST RECENT allocation a split across several warehouses?
 *
 * A split is one allocation to more than one warehouse — so the answer lives in
 * the round ledger: the latest round having produced more than one part. Read
 * from the ledger rather than from the parts' current statuses because a split's
 * rejections arrive one at a time, and the answer must not depend on how many
 * have landed yet.
 *
 * Pure, so the sync processor can decide "re-allocate or hand back to the buyer"
 * without a fixture.
 */
export function latestRoundWasSplit(offers: RoundOffer[]): boolean {
  if (offers.length < 2) return false;
  const latest = Math.max(...offers.map((o) => o.roundNumber));
  const partsInLatest = new Set(
    offers.filter((o) => o.roundNumber === latest).map((o) => o.partId),
  );
  return partsInLatest.size > 1;
}
