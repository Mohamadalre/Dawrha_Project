import { CatalogService } from './catalog.service';
import { PricingTier } from '../enums/pricing-tier.enum';
import { OfferAudience } from '../enums/offer-audience.enum';

/**
 * What a material's payload says about the offers on it.
 *
 * Three things this pins, all of which were wrong at some point:
 *
 *   1. a graded material can carry an offer PER CONDITION, and the reader used
 *      to keep the first and drop the rest — so two of three discounted grades
 *      never reached the buyer, silently;
 *
 *   2. the discount shown is COMPUTED against the material's own price for this
 *      buyer, not read from the `discount_percentage` column an administrator
 *      types in and which is free to disagree with the prices either side of it;
 *
 *   3. the offer stores an AMOUNT, not a final price. The price this reader
 *      pays is their own list price with the amount applied — taken off for a
 *      buyer, added on for a seller — because one offer reaches two roles who
 *      are priced differently and a stored final price could only ever have
 *      been right for one of them.
 */
describe('offer payload on a material', () => {
  let service: CatalogService;

  const svc = () => new (CatalogService as any)();

  const price = (over: any = {}) => ({
    tier: PricingTier.FACTORY,
    conditionCode: null,
    price: '100',
    effectiveFrom: new Date(Date.now() - 86_400_000),
    effectiveUntil: null,
    ...over,
  });

  const offer = (over: any = {}) => ({
    productId: 'p1',
    conditionCode: null,
    // A FACTORY reads this catalogue, so the offer is a buyer's: the amount
    // comes off what they already pay.
    audience: OfferAudience.BUYERS,
    amount: '50',
    discountPercentage: '99', // deliberately a lie — must never be used
    validUntil: null,
    ...over,
  });

  const product = { id: 'p1', name: 'PET', categoryId: 'c1', unitType: 'KG', createdAt: new Date() };

  const map = (prices: any[], offers: any[], tier = PricingTier.FACTORY) =>
    (service as any).mapProduct(product, prices, offers, new Map(), tier, new Map());

  beforeEach(() => {
    service = svc();
  });

  // ── the discount is measured, not quoted ────────────────────────────────
  it('computes the discount from the material own price, ignoring the typed column', () => {
    const out = map([price({ price: '100' })], [offer({ amount: '50' })]);

    // 50 off a list price of 100 is 50%, whatever the column claims — and the
    // price this buyer pays is the 50 that is left, not a number the offer
    // carries.
    expect(out.discount_percentage).toBe(50);
    expect(out.offer_price).toBe(50);
  });

  it('ADDS the amount when the offer is a seller’s', () => {
    // The same row read from the other side of the trade. A seller listed at
    // 100 with a 50 offer is paid 150 — applying it the buyer's way would
    // quietly halve what the platform pays them.
    const out = map(
      [price({ tier: PricingTier.INDIVIDUAL, price: '100' })],
      [offer({ audience: OfferAudience.SELLERS, amount: '50' })],
      PricingTier.INDIVIDUAL,
    );

    expect(out.offers[0].offer_price).toBe(150);
    expect(out.offers[0].direction).toBe('INCREASE');
  });

  it('reports no discount when the material has no price for this buyer', () => {
    // Zero would sort it among genuine small discounts; null says "unknown".
    const out = map([], [offer()]);

    expect(out.discount_percentage).toBeNull();
    expect(out.offers[0].base_price).toBeNull();
  });

  // ── several grades, several offers ──────────────────────────────────────
  it('returns EVERY live offer, one per condition', () => {
    const prices = [
      price({ conditionCode: 'EXCELLENT', price: '200' }),
      price({ conditionCode: 'GOOD', price: '100' }),
      price({ conditionCode: 'POOR', price: '50' }),
    ];
    const offers = [
      offer({ conditionCode: 'EXCELLENT', amount: '10' }), // 10 off 200 →  5%
      offer({ conditionCode: 'GOOD', amount: '50' }), //      50 off 100 → 50%
      offer({ conditionCode: 'POOR', amount: '5' }), //        5 off  50 → 10%
    ];

    const out = map(prices, offers);

    expect(out.offers).toHaveLength(3);
    expect(out.offers.map((o: any) => o.condition)).toEqual(['GOOD', 'POOR', 'EXCELLENT']);
    expect(out.offers.map((o: any) => o.discount_percentage)).toEqual([50, 10, 5]);
  });

  it('prices each offer against ITS OWN grade, not the cheapest one', () => {
    const prices = [
      price({ conditionCode: 'EXCELLENT', price: '200' }),
      price({ conditionCode: 'POOR', price: '50' }),
    ];

    const out = map(prices, [offer({ conditionCode: 'EXCELLENT', amount: '100' })]);

    // 100 off the 200 excellent price = 50%. Measured against the 50 poor
    // price the same amount would read as 200% — a free material and change.
    expect(out.offers[0].base_price).toBe(200);
    expect(out.offers[0].discount_percentage).toBe(50);
  });

  it('makes the headline the BEST real saving', () => {
    const prices = [
      price({ conditionCode: 'A', price: '100' }),
      price({ conditionCode: 'B', price: '100' }),
    ];
    const offers = [
      offer({ conditionCode: 'A', amount: '10' }), // 10 off 100 → 10%
      offer({ conditionCode: 'B', amount: '80' }), // 80 off 100 → 80%
    ];

    const out = map(prices, offers);

    expect(out.discount_percentage).toBe(80);
    expect(out.offer_price).toBe(20);
  });

  // ── the payload carries only the READER's price ─────────────────────────
  it('returns a single price for the caller tier, never the four-tier matrix', () => {
    const prices = [
      price({ tier: PricingTier.INDIVIDUAL, conditionCode: null, price: '100' }),
      price({ tier: PricingTier.FACTORY, conditionCode: 'EXCELLENT', price: '70' }),
      price({ tier: PricingTier.FACTORY, conditionCode: 'GOOD', price: '60' }),
    ];

    const factory = map(prices, [], PricingTier.FACTORY);
    // Graded tier → "starting from" = the lowest condition price.
    expect(factory.price).toBe(60);
    expect(factory).not.toHaveProperty('pricing');

    const citizen = map(prices, [], PricingTier.INDIVIDUAL);
    expect(citizen.price).toBe(100);
    // A citizen must never see a factory number ANYWHERE in the payload.
    expect(JSON.stringify(citizen)).not.toContain('70');
    expect(JSON.stringify(citizen)).not.toContain('60');
  });

  // ── when it ends ────────────────────────────────────────────────────────
  it('says when the offer ends', () => {
    const ends = new Date('2026-12-31T00:00:00Z');

    const out = map([price()], [offer({ validUntil: ends })]);

    expect(out.offer_valid_until).toEqual(ends);
    expect(out.offers[0].valid_until).toEqual(ends);
  });

  it('distinguishes open-ended from ending', () => {
    // A countdown on an offer that never ends is a lie; no date on one that
    // does is worse.
    const out = map([price()], [offer({ validUntil: null })]);

    expect(out.offer_valid_until).toBeNull();
  });

  // ── no offer at all ─────────────────────────────────────────────────────
  it('is quiet when the material carries no offer', () => {
    const out = map([price()], []);

    expect(out.has_offer).toBe(false);
    expect(out.offers).toEqual([]);
    expect(out.offer_price).toBeNull();
    expect(out.offer_valid_until).toBeNull();
  });
});
