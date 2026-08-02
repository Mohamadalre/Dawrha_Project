import {
  FLAT_TIERS,
  GRADED_TIERS,
  isPricedPerCondition,
} from './pricing-shape';
import { PricingTier } from '../../enums/pricing-tier.enum';

describe('pricing shape', () => {
  describe('a material WITH conditions', () => {
    const graded = true;

    it('prices factories and free facilities per condition', () => {
      expect(isPricedPerCondition(PricingTier.FACTORY, graded)).toBe(true);
      expect(isPricedPerCondition(PricingTier.FREE_FACILITY, graded)).toBe(true);
    });

    it('still gives individuals and companies a single price', () => {
      // They buy the material, not a sorted quality band — pricing every grade
      // for them would force the admin to invent numbers nobody uses.
      expect(isPricedPerCondition(PricingTier.INDIVIDUAL, graded)).toBe(false);
      expect(isPricedPerCondition(PricingTier.COMPANY, graded)).toBe(false);
    });
  });

  describe('a material with NO conditions', () => {
    const ungraded = false;

    it('gives EVERY tier one price, factories included', () => {
      // This is the case that used to be got wrong: with nothing to grade,
      // demanding a condition asks for a value that does not exist.
      for (const tier of Object.values(PricingTier)) {
        expect(isPricedPerCondition(tier, ungraded)).toBe(false);
      }
    });
  });

  it('keeps the two tier groups disjoint and complete', () => {
    // Guards against a tier being added to the enum and silently belonging to
    // neither group — which would make its pricing shape undefined.
    const all = Object.values(PricingTier).sort();
    const covered = [...GRADED_TIERS, ...FLAT_TIERS].sort();
    expect(covered).toEqual(all);
    expect(GRADED_TIERS.filter((t) => FLAT_TIERS.includes(t))).toHaveLength(0);
  });
});
