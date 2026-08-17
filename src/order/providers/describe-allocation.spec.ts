import { describeAllocation } from './order-allocation.service';

/**
 * A checkout response used to hand the buyer the raw allocation CODE
 * (`PARTIAL_NEEDS_BUYER`, `NO_STOCK`, …). `describeAllocation` turns each into a
 * sentence a person can read, which is what the response now carries alongside
 * the code.
 */
describe('describeAllocation', () => {
  it('gives a clear sentence for a placed order', () => {
    const msg = describeAllocation({ result: 'ALLOCATED', parts: 2 });
    expect(msg).toMatch(/placed/i);
    expect(msg).not.toMatch(/ALLOCATED/);
  });

  it('explains a partial order in plain words, not the code', () => {
    const msg = describeAllocation({ result: 'PARTIAL_NEEDS_BUYER', missingRatio: 0.3 });
    expect(msg).toMatch(/only part/i);
    expect(msg).not.toMatch(/PARTIAL_NEEDS_BUYER/);
  });

  it('explains out-of-stock plainly', () => {
    const msg = describeAllocation({ result: 'NO_STOCK' });
    expect(msg).toMatch(/out of stock/i);
    expect(msg).not.toMatch(/NO_STOCK/);
  });

  it('explains an exhausted allocation plainly', () => {
    const msg = describeAllocation({ result: 'EXHAUSTED' });
    expect(msg).toMatch(/administrator|automatically/i);
    expect(msg).not.toMatch(/EXHAUSTED/);
  });

  it('every outcome yields a non-empty, code-free message', () => {
    const outcomes = [
      { result: 'ALLOCATED', parts: 0 },
      { result: 'ALLOCATED', parts: 1 },
      { result: 'PARTIAL_NEEDS_BUYER', missingRatio: 0.1 },
      { result: 'NO_STOCK' },
      { result: 'EXHAUSTED' },
    ] as const;
    for (const o of outcomes) {
      const msg = describeAllocation(o as any);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/[A-Z_]{4,}/); // no SCREAMING_CODE leaked
    }
  });
});
