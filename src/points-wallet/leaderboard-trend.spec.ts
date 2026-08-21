import { deriveTrend } from './leaderboard-trend';

describe('deriveTrend', () => {
  it('UP when the user climbed (current rank lower than baseline)', () => {
    expect(deriveTrend(2, 5)).toEqual({ trend: 'UP', rank_change: 3 });
  });

  it('DOWN when the user slipped (current rank higher than baseline)', () => {
    expect(deriveTrend(7, 4)).toEqual({ trend: 'DOWN', rank_change: -3 });
  });

  it('SAME when the position is unchanged', () => {
    expect(deriveTrend(3, 3)).toEqual({ trend: 'SAME', rank_change: 0 });
  });

  it('SAME with no baseline (first appearance) — never invents a move', () => {
    expect(deriveTrend(1, null)).toEqual({ trend: 'SAME', rank_change: 0 });
    expect(deriveTrend(9, undefined)).toEqual({ trend: 'SAME', rank_change: 0 });
  });

  it('climbing to 1st from far down is a large positive change', () => {
    expect(deriveTrend(1, 20)).toEqual({ trend: 'UP', rank_change: 19 });
  });
});
