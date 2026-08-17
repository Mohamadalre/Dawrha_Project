import { latestRoundWasSplit } from './latest-round-split';

/**
 * Telling a split (one allocation to several warehouses, one admin verdict) from
 * a single warehouse's rejection (which re-allocates elsewhere). Read from the
 * round ledger so the answer is stable no matter how the rejections are timed.
 */
describe('latestRoundWasSplit', () => {
  it('is true when the latest round produced more than one part', () => {
    expect(
      latestRoundWasSplit([
        { roundNumber: 1, partId: 'a' },
        { roundNumber: 1, partId: 'b' },
      ]),
    ).toBe(true);
  });

  it('is false for a single-warehouse order', () => {
    expect(latestRoundWasSplit([{ roundNumber: 1, partId: 'a' }])).toBe(false);
  });

  it('looks only at the LATEST round, ignoring earlier failed attempts', () => {
    // Round 1 was a single that got rejected; round 2 re-allocated to one other
    // warehouse. That is still a single-warehouse order, not a split.
    expect(
      latestRoundWasSplit([
        { roundNumber: 1, partId: 'old' },
        { roundNumber: 2, partId: 'new' },
      ]),
    ).toBe(false);
  });

  it('sees a split even after an earlier single attempt', () => {
    // Round 1 single failed; round 2 split across two warehouses.
    expect(
      latestRoundWasSplit([
        { roundNumber: 1, partId: 'old' },
        { roundNumber: 2, partId: 'x' },
        { roundNumber: 2, partId: 'y' },
      ]),
    ).toBe(true);
  });

  it('is false with no offers at all', () => {
    expect(latestRoundWasSplit([])).toBe(false);
  });

  it('counts DISTINCT parts, not offer rows', () => {
    // One part can carry more than one offer row across retries; a split is about
    // distinct parts in the round, not the number of ledger entries.
    expect(
      latestRoundWasSplit([
        { roundNumber: 2, partId: 'a' },
        { roundNumber: 2, partId: 'a' },
      ]),
    ).toBe(false);
  });
});
