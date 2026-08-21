import { PricingTier } from '../enums/pricing-tier.enum';
import {
  AUDIENCE_QUOTED_TIERS,
  AUDIENCE_ROLES,
  AUDIENCE_TIERS,
  GuestAudience,
} from '../enums/guest-audience.enum';
import { Role } from '@src/user/enums/role.enum';
import { mapTierPrices, PriceRowView } from './guest-app.service';

const row = (
  tier: PricingTier,
  price: number,
  conditionCode: string | null = null,
  effectiveFrom = '2026-01-01',
): PriceRowView => ({ tier, price, conditionCode, effectiveFrom });

const grades = new Map<string, { id: string; code: string; name: string; sort_order: number }>([
  ['p1:EXCELLENT', { id: 'ce', code: 'EXCELLENT', name: 'ممتاز', sort_order: 1 }],
  ['p1:GOOD', { id: 'cg', code: 'GOOD', name: 'جيد', sort_order: 2 }],
]);

/**
 * The price sheet a visitor is shown, asserted directly.
 *
 * These are not "does it run" tests. Each one pins a rule that decides what a
 * visitor believes they will be paid, and every one of them is a rule that would
 * be silently wrong if the shaping drifted.
 */
describe('mapTierPrices', () => {
  it('quotes ONE price in the user app, even where a company price exists', () => {
    // A visitor has no role yet, so two prices side by side is a question they
    // cannot answer. What they are deciding is whether this is worth
    // registering for, and one indicative number answers that.
    const out = mapTierPrices(
      GuestAudience.USER,
      [row(PricingTier.INDIVIDUAL, 0.3), row(PricingTier.COMPANY, 0.27)],
      'p1',
      grades,
    );

    expect(out).toEqual({ individual: { price: 0.3 } });
  });

  it('quotes ONE price in the factory app, even where a free-facility price exists', () => {
    // Same rule as the user app, for the same reason: a visitor has no role
    // yet, so each app quotes its PRIMARY tier and the secondary role is
    // quoted its own sheet the moment it has an account.
    const out = mapTierPrices(
      GuestAudience.FACTORY,
      [
        row(PricingTier.FACTORY, 0.9, 'EXCELLENT'),
        row(PricingTier.FREE_FACILITY, 0.85, 'EXCELLENT'),
      ],
      'p1',
      grades,
    );

    expect(Object.keys(out)).toEqual(['factory']);
    expect(JSON.stringify(out)).not.toContain('0.85');
  });

  it('still SHOWS a material priced only for free facilities', () => {
    // The same trap as the institutions one below. Narrowing VISIBILITY to
    // match the quote would remove every free-facility-only material from the
    // visitor catalogue — a far larger change, invisible from the payload.
    expect(AUDIENCE_TIERS[GuestAudience.FACTORY]).toContain(
      PricingTier.FREE_FACILITY,
    );
    expect(AUDIENCE_QUOTED_TIERS[GuestAudience.FACTORY]).not.toContain(
      PricingTier.FREE_FACILITY,
    );
  });

  it('quotes exactly one tier per app', () => {
    // The whole point: one indicative number, not a table a visitor has to
    // choose a row from.
    for (const audience of Object.values(GuestAudience)) {
      expect(AUDIENCE_QUOTED_TIERS[audience]).toHaveLength(1);
    }
  });

  it('still SHOWS a material priced only for institutions', () => {
    // The trap in trimming the price sheet: visibility and quoting were one
    // list, so narrowing it would have removed every institution-only material
    // from the visitor catalogue — a far larger change, invisible from the
    // payload. An institution browsing before it signs up must still find the
    // materials that were priced for it.
    expect(AUDIENCE_TIERS[GuestAudience.USER]).toContain(PricingTier.COMPANY);
    expect(AUDIENCE_QUOTED_TIERS[GuestAudience.USER]).not.toContain(
      PricingTier.COMPANY,
    );
  });

  it('never leaks a factory price into the user app', () => {
    const out = mapTierPrices(
      GuestAudience.USER,
      [
        row(PricingTier.INDIVIDUAL, 0.3),
        // Present in the data, and must not be present in the answer: the whole
        // point of splitting the apps is that this sheet stays commercial.
        row(PricingTier.FACTORY, 0.9, 'EXCELLENT'),
        row(PricingTier.FREE_FACILITY, 0.85, 'EXCELLENT'),
      ],
      'p1',
      grades,
    );

    expect(Object.keys(out)).toEqual(['individual']);
    expect(JSON.stringify(out)).not.toContain('0.9');
  });

  it('never leaks a citizen price into the factory app', () => {
    const out = mapTierPrices(
      GuestAudience.FACTORY,
      [row(PricingTier.INDIVIDUAL, 0.3), row(PricingTier.FACTORY, 0.9, 'EXCELLENT')],
      'p1',
      grades,
    );

    expect(Object.keys(out)).toEqual(['factory']);
  });

  it('prices a graded material per grade, cheapest first, with price_from', () => {
    const out = mapTierPrices(
      GuestAudience.FACTORY,
      [
        row(PricingTier.FACTORY, 0.9, 'EXCELLENT'),
        row(PricingTier.FACTORY, 0.6, 'GOOD'),
      ],
      'p1',
      grades,
    );

    expect(out.factory.price_from).toBe(0.6);
    expect(out.factory.conditions).toEqual([
      { condition: { id: 'cg', code: 'GOOD', name: 'جيد', sort_order: 2 }, price: 0.6 },
      { condition: { id: 'ce', code: 'EXCELLENT', name: 'ممتاز', sort_order: 1 }, price: 0.9 },
    ]);
  });

  it('prices an UNGRADED material once even for a graded tier', () => {
    // A material with no grades is sold at one price to everyone. Demanding a
    // per-grade price here would ask for a value that does not exist.
    const out = mapTierPrices(
      GuestAudience.FACTORY,
      [row(PricingTier.FACTORY, 0.75, null)],
      'p2',
      grades,
    );

    expect(out.factory).toEqual({ price: 0.75 });
    expect(out.factory.conditions).toBeUndefined();
  });

  it('OMITS a tier with no live price instead of reporting it as zero', () => {
    // Zero is a price — "we take this for nothing". "We do not buy this from
    // your kind of buyer" is a different statement, and a client that renders
    // whatever number it is handed cannot tell the two apart.
    const out = mapTierPrices(
      GuestAudience.USER,
      [row(PricingTier.INDIVIDUAL, 0.3)],
      'p1',
      grades,
    );

    expect(out.company).toBeUndefined();
    expect('company' in out).toBe(false);
  });

  it('returns nothing at all for a material priced for neither tier', () => {
    expect(mapTierPrices(GuestAudience.USER, [], 'p1', grades)).toEqual({});
  });

  it('takes the newest effective row when a flat tier has several live', () => {
    const out = mapTierPrices(
      GuestAudience.USER,
      [
        row(PricingTier.INDIVIDUAL, 0.2, null, '2026-01-01'),
        row(PricingTier.INDIVIDUAL, 0.35, null, '2026-06-01'),
      ],
      'p1',
      grades,
    );

    expect(out.individual).toEqual({ price: 0.35 });
  });

  it('falls back to a code-only object when a grade is not in the map', () => {
    const out = mapTierPrices(
      GuestAudience.FACTORY,
      [row(PricingTier.FACTORY, 0.5, 'UNLABELLED')],
      'p1',
      grades,
    );

    expect(out.factory.conditions![0].condition).toEqual({
      id: null,
      code: 'UNLABELLED',
      name: 'UNLABELLED',
      sort_order: null,
    });
  });
});

/**
 * The audience tables are the security boundary between the two apps. If a tier
 * or a role ever appears under both audiences, every isolation test above passes
 * while the isolation itself is gone — so they are asserted directly.
 */
describe('audience isolation tables', () => {
  it('shares no pricing tier between the two apps', () => {
    const user = new Set<PricingTier>(AUDIENCE_TIERS[GuestAudience.USER]);
    const overlap = AUDIENCE_TIERS[GuestAudience.FACTORY].filter((t) => user.has(t));

    expect(overlap).toEqual([]);
  });

  it('shares no buyer role between the two apps', () => {
    const user = new Set<Role>(AUDIENCE_ROLES[GuestAudience.USER]);
    const overlap = AUDIENCE_ROLES[GuestAudience.FACTORY].filter((r) => user.has(r));

    expect(overlap).toEqual([]);
  });

  it('makes every pricing tier visible in exactly one app', () => {
    const all = [
      ...AUDIENCE_TIERS[GuestAudience.USER],
      ...AUDIENCE_TIERS[GuestAudience.FACTORY],
    ].sort();

    // A tier belonging to no app would be invisible to every visitor — a
    // material priced only at that tier would vanish from both catalogues.
    // This is about VISIBILITY, which is why it reads the wider list: the
    // quoted list is deliberately narrower and must not be checked here.
    expect(all).toEqual([...Object.values(PricingTier)].sort());
  });

  it('never quotes a tier the audience cannot even see', () => {
    // The quoted list is a subset of the visible one, in both directions of
    // the app split. Quoting a price for a tier whose materials are filtered
    // out would print a number against nothing.
    for (const audience of Object.values(GuestAudience)) {
      const visible = new Set<PricingTier>(AUDIENCE_TIERS[audience]);
      for (const quoted of AUDIENCE_QUOTED_TIERS[audience]) {
        expect(visible.has(quoted)).toBe(true);
      }
    }
  });
});
