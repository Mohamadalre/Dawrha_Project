import { EffectivePriceService } from './effective-price.service';
import { OfferAudience } from '../../enums/offer-audience.enum';
import { PricingTier } from '../../enums/pricing-tier.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * The one place that answers "what is THIS buyer charged for THIS material right
 * now?" — list price with any live offer applied.
 *
 * It exists because the answer was being computed in several places and the
 * place it was missing was the one that takes money: the catalogue applied the
 * offer, the basket applied it, and checkout re-read the list price and charged
 * that. A buyer saw a discount on every screen, agreed to it, and was invoiced
 * the full amount — and nothing looked broken, because each screen was right on
 * its own.
 *
 * Two things are pinned here: the offer is applied in the RIGHT DIRECTION for
 * the audience, and a seller offer is never allowed to touch a buyer's price.
 * The freshness guarantee — that an offer which ended between basket and
 * checkout is not applied — is a property of the SQL WHERE clause and is proven
 * live rather than against a mock that cannot run it.
 */
describe('EffectivePriceService', () => {
  const PRODUCT = 'prod-1';

  /**
   * A query-builder mock that records the clauses it was given (so the audience
   * filter can be asserted) and returns whatever offer the test planted.
   */
  const makeService = (opts: {
    base: number | null;
    offer: any | null;
  }) => {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    const qb: any = {
      where: jest.fn((c: string, p: any) => {
        clauses.push(c);
        Object.assign(params, p ?? {});
        return qb;
      }),
      andWhere: jest.fn((c: string, p: any) => {
        clauses.push(c);
        Object.assign(params, p ?? {});
        return qb;
      }),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => opts.offer),
    };
    const offerRepo = { createQueryBuilder: jest.fn(() => qb) };
    const sellability = { priceFor: jest.fn(async () => opts.base) };
    const service = new EffectivePriceService(
      offerRepo as any,
      sellability as any,
    );
    return { service, clauses, params, sellability };
  };

  const buyerOffer = (over: any = {}) => ({
    id: 'off-1',
    productId: PRODUCT,
    audience: OfferAudience.BUYERS,
    amount: '3',
    conditionCode: null,
    ...over,
  });

  it('takes the amount OFF for a buyer', async () => {
    const { service } = makeService({ base: 10, offer: buyerOffer({ amount: '3' }) });

    const out = await service.effectivePrice(PRODUCT, Role.FACTORY);

    expect(out).toEqual(
      expect.objectContaining({ basePrice: 10, price: 7 }),
    );
    expect(out!.offer).not.toBeNull();
  });

  it('ADDS the amount for a seller', async () => {
    const { service } = makeService({
      base: 10,
      offer: buyerOffer({ audience: OfferAudience.SELLERS, amount: '3' }),
    });

    const out = await service.effectivePrice(PRODUCT, Role.CITIZEN);

    // Same 3, opposite direction — a citizen is PAID 13, not charged 7.
    expect(out!.price).toBe(13);
  });

  it('is just the list price when there is no live offer', async () => {
    const { service } = makeService({ base: 10, offer: null });

    const out = await service.effectivePrice(PRODUCT, Role.FACTORY);

    expect(out).toEqual({ basePrice: 10, offer: null, price: 10 });
  });

  it('returns null when the buyer has no price for the material', async () => {
    const { service } = makeService({ base: null, offer: buyerOffer() });

    expect(await service.effectivePrice(PRODUCT, Role.FACTORY)).toBeNull();
  });

  it('filters offers to the buyer AUDIENCE, so a seller offer never reaches a buyer', async () => {
    // A factory is a BUYER: the query must ask only for buyer offers. Without
    // this an unrole-targeted seller offer would match and be applied as an
    // INCREASE — quietly charging the factory MORE than the list price.
    const { service, params } = makeService({ base: 10, offer: null });

    await service.liveOfferFor(PRODUCT, Role.FACTORY);

    expect(params.audience).toBe(OfferAudience.BUYERS);
  });

  it('asks for a SELLER audience when the reader is a seller', async () => {
    const { service, params } = makeService({ base: 10, offer: null });

    await service.liveOfferFor(PRODUCT, Role.INSTITUTIONS);

    expect(params.audience).toBe(OfferAudience.SELLERS);
  });

  it('looks up the price against the reader’s own tier', async () => {
    const { service, sellability } = makeService({ base: 10, offer: null });

    await service.effectivePrice(PRODUCT, Role.FACTORY, 'GOOD');

    expect(sellability.priceFor).toHaveBeenCalledWith(
      PRODUCT,
      PricingTier.FACTORY,
      'GOOD',
    );
  });
});
