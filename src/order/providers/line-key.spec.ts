import { lineKey } from './order-allocation.service';

/**
 * The allocator matches an order's lines to warehouse stock by `lineKey`, so the
 * two sides MUST agree on how "no grade" is spelled.
 *
 * An ungraded material's order carries a NULL condition; its stock, mirrored
 * from Odoo, carries the sentinel 'UNGRADED' (unsorted). Live testing showed
 * these produced different keys ("2:" vs "2:UNGRADED"), so an ungraded order
 * could never be filled from its own stock and fell straight to NEEDS_ADMIN.
 * lineKey now folds UNGRADED into the empty no-grade bucket — while a REAL grade
 * ('GOOD') keeps its own key and never collides with it.
 */
describe('lineKey — UNGRADED folds into the no-grade bucket', () => {
  it('treats UNGRADED stock as the same bucket as a null-condition order', () => {
    expect(lineKey(2, 'UNGRADED')).toBe(lineKey(2, null));
    expect(lineKey(2, 'UNGRADED')).toBe('2:');
    expect(lineKey(2, 'ungraded')).toBe('2:'); // case-insensitive
  });

  it('keeps a real grade distinct from the no-grade bucket', () => {
    expect(lineKey(2, 'GOOD')).toBe('2:GOOD');
    expect(lineKey(2, 'GOOD')).not.toBe(lineKey(2, 'UNGRADED'));
  });

  it('keeps different materials and grades apart', () => {
    expect(lineKey(2, 'GOOD')).not.toBe(lineKey(3, 'GOOD'));
    expect(lineKey(2, 'GOOD')).not.toBe(lineKey(2, 'EXCELLENT'));
  });
});
