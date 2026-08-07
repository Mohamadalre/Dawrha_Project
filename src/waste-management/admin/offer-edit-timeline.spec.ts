import { BadRequestException } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service';
import { OfferAudience } from '../enums/offer-audience.enum';
import { OfferBasis } from '../enums/offer-basis.enum';
import { PricingTier } from '../enums/pricing-tier.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * Editing an offer's size — by AMOUNT or by PERCENTAGE — through the /amount
 * route, and reading a material's offer TIMELINE.
 *
 * The edit mirrors creation: exactly one of amount/percentage, the basis follows
 * what was sent (an amount overrides a percentage promise; a percentage becomes
 * the promise so a later price move recomputes the amount), and the same
 * negative-price guard applies.
 */
describe('offer edit — amount vs percentage', () => {
  const PRODUCT = 'prod-1';
  let service: AdminCatalogService;
  let saved: any;

  // One flat BUYER offer targeted at factories only, so the row faces a single
  // tier (FACTORY = 80) and the arithmetic is easy to assert.
  const makeOffer = (over: any = {}) => ({
    id: 'off-1',
    productId: PRODUCT,
    audience: OfferAudience.BUYERS,
    targetRoles: [Role.FACTORY],
    conditionId: null,
    conditionCode: null,
    amount: '20',
    discountPercentage: '25',
    basis: OfferBasis.AMOUNT,
    basisPercentage: null,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: undefined,
    isActive: true,
    ...over,
  });

  beforeEach(() => {
    const priceSheet: Record<string, number> = {
      [PricingTier.FACTORY]: 80,
      [PricingTier.FREE_FACILITY]: 80,
    };
    const pricingRepo = {
      createQueryBuilder: jest.fn(() => {
        const state: any = { tier: null };
        const qb: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn((_clause: string, params: any) => {
            if (params?.tier) state.tier = params.tier;
            return qb;
          }),
          orderBy: jest.fn().mockReturnThis(),
          getOne: jest.fn(async () => {
            const p = priceSheet[state.tier];
            return p == null ? null : { price: String(p) };
          }),
        };
        return qb;
      }),
    };
    const offerRepo = {
      findOne: jest.fn(async () => makeOffer()),
      save: jest.fn(async (x: any) => {
        saved = x;
        return x;
      }),
    };
    // productOfOffer → product with no odooProductId, so no Odoo push is made.
    const productRepo = { findOne: jest.fn(async () => ({ id: PRODUCT, name: 'PET' })) };
    const noop = { invalidate: jest.fn(), record: jest.fn() };
    const odooSync = { enqueueUpdatePricing: jest.fn() };

    service = new AdminCatalogService(
      {} as any, productRepo as any, {} as any, {} as any, {} as any, {} as any,
      pricingRepo as any, offerRepo as any, odooSync as any,
      noop as any, noop as any, {} as any, {} as any, {} as any,
    );
  });

  const edit = (dto: any) => service.updateOfferAmount('admin-1', 'off-1', dto);

  it('edits by AMOUNT — basis AMOUNT, percentage re-derived', async () => {
    const res = await edit({ amount: 30 });

    expect(saved.basis).toBe(OfferBasis.AMOUNT);
    expect(saved.basisPercentage).toBeNull();
    expect(Number(saved.amount)).toBe(30);
    expect(Number(saved.discountPercentage)).toBe(37.5); // 30/80
    expect(res.offer.effect.amount).toBe(30);
  });

  it('edits by PERCENTAGE — basis PERCENTAGE, amount derived, promise kept', async () => {
    await edit({ percentage: 25 });

    expect(saved.basis).toBe(OfferBasis.PERCENTAGE);
    expect(Number(saved.basisPercentage)).toBe(25);
    expect(Number(saved.amount)).toBe(20); // 25% of 80
    expect(Number(saved.discountPercentage)).toBe(25);
  });

  it('a PERCENTAGE edit OVERRIDES a prior amount basis', async () => {
    // Offer started life amount-based; a percentage edit flips the promise.
    await edit({ percentage: 50 });
    expect(saved.basis).toBe(OfferBasis.PERCENTAGE);
    expect(Number(saved.amount)).toBe(40); // 50% of 80
  });

  it('refuses BOTH an amount and a percentage', async () => {
    await expect(edit({ amount: 10, percentage: 20 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses NEITHER an amount nor a percentage', async () => {
    await expect(edit({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still refuses a buyer amount that would drive the price negative', async () => {
    // 90 off an 80 price would pay the buyer to take the material away.
    await expect(edit({ amount: 90 })).rejects.toThrow(/zero or below|negative|more than/i);
  });

  it('refuses a buyer percentage of 100 — the price reaches zero', async () => {
    await expect(edit({ percentage: 100 })).rejects.toThrow(/100%/);
  });
});

describe('offer timeline — a material’s offers over time', () => {
  const PRODUCT = 'prod-1';
  let service: AdminCatalogService;
  let capturedWhere: Array<{ clause: string; params: any }>;

  const row = (over: any) => ({
    id: 'o',
    productId: PRODUCT,
    product: { id: PRODUCT, name: 'PET' },
    audience: OfferAudience.BUYERS,
    targetRoles: [Role.FACTORY],
    conditionId: null,
    conditionCode: null,
    amount: '5',
    discountPercentage: '6.25',
    basis: OfferBasis.AMOUNT,
    basisPercentage: null,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: new Date('2026-02-01T00:00:00Z'),
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });

  const build = (rows: any[]) => {
    capturedWhere = [];
    const offerRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn((clause: string, params: any) => {
            capturedWhere.push({ clause, params });
            return qb;
          }),
          orderBy: jest.fn().mockReturnThis(),
          addOrderBy: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getManyAndCount: jest.fn(async () => [rows, rows.length]),
        };
        return qb;
      }),
    };
    const productRepo = { findOne: jest.fn(async () => ({ id: PRODUCT, name: 'PET' })) };
    service = new AdminCatalogService(
      {} as any, productRepo as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, offerRepo as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  };

  it('with `on`, filters to offers whose window contains that instant', async () => {
    build([row({})]);
    const res = await service.offerTimeline(PRODUCT, {
      on: '2026-01-15T00:00:00Z', page: 1, limit: 10,
    } as any);

    // validFrom <= on  AND  (validUntil IS NULL OR validUntil > on)
    const clauses = capturedWhere.map((w) => w.clause).join(' | ');
    expect(clauses).toMatch(/validFrom <= :on/);
    expect(clauses).toMatch(/validUntil IS NULL OR o\.validUntil > :on/);
    expect(res.filter.on).toBe('2026-01-15T00:00:00Z');
    expect(res.offers).toHaveLength(1);
    expect(res.product).toEqual({ id: PRODUCT, name: 'PET' });
  });

  it('with `from`/`to`, filters to offers whose window overlaps the range', async () => {
    build([row({})]);
    await service.offerTimeline(PRODUCT, {
      from: '2026-01-10T00:00:00Z', to: '2026-01-20T00:00:00Z', page: 1, limit: 10,
    } as any);

    const clauses = capturedWhere.map((w) => w.clause).join(' | ');
    expect(clauses).toMatch(/validFrom <= :to/);
    expect(clauses).toMatch(/validUntil IS NULL OR o\.validUntil > :from/);
    // `on` was not sent, so its clause must be absent.
    expect(clauses).not.toMatch(/:on/);
  });

  it('with no filter, returns the whole timeline (only the product clause)', async () => {
    build([row({}), row({ id: 'o2' })]);
    const res = await service.offerTimeline(PRODUCT, { page: 1, limit: 10 } as any);

    // No date andWhere at all — just the base productId `where`.
    expect(capturedWhere).toHaveLength(0);
    expect(res.offers).toHaveLength(2);
    expect(res.filter).toEqual({ on: null, from: null, to: null });
  });

  it('exposes the basis on each timeline row', async () => {
    build([row({ basis: OfferBasis.PERCENTAGE, basisPercentage: '25' })]);
    const res = await service.offerTimeline(PRODUCT, { page: 1, limit: 10 } as any);
    expect(res.offers[0].basis).toBe(OfferBasis.PERCENTAGE);
    expect(res.offers[0].basis_percentage).toBe(25);
  });
});
