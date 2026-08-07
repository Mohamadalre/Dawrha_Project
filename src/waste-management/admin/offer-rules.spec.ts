import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service';
import { Role } from '@src/user/enums/role.enum';
import { PricingTier } from '../enums/pricing-tier.enum';
import { OfferAudience } from '../enums/offer-audience.enum';

/**
 * What an offer MEANS, and therefore what may be sent to create one.
 *
 * An offer names a SIDE of the trade and an AMOUNT. There is no offer aimed at
 * everybody, because the two sides move in opposite directions:
 *
 *   SELLERS — citizens and institutions — hand material in and are PAID. An
 *   offer to them is a rise: the amount is ADDED to what they already get;
 *
 *   BUYERS — factories and free facilities — take material away and PAY. An
 *   offer to them is a reduction: the amount comes OFF what they already pay.
 *
 * The number is not a final price, and that is the whole reason it is an
 * amount. One offer reaches two roles who are priced differently, so a single
 * final price cannot be right for both — 7.50 is a discount off a factory's 10
 * and a rise on a free facility's 6. An amount applies to whatever each of
 * them already pays.
 *
 * Two things follow, and everything below tests one of them:
 *
 *   only BUYERS are priced per GRADE, so only a buyer offer may name one — a
 *   seller is paid before the material is ever sorted;
 *
 *   a buyer amount larger than a price does not produce a small price, it
 *   produces a NEGATIVE one, which means paying somebody to take the material
 *   away. It has to hold against every tier and grade the row faces.
 *
 * The PERCENTAGE is never accepted, only derived — from the amount and the
 * material's own price, every time either moves — so a "biggest offers" list
 * ranks by money rather than by somebody's arithmetic.
 */
describe('offer rules — audience, amount, grades and the derived percentage', () => {
  let service: AdminCatalogService;
  let offerRepo: any;
  let pricingRepo: any;
  let conditions: any;
  let productRepo: any;
  let odooSync: any;
  let saved: any[];

  const GRADED = 'prod-graded';

  /** Live list prices, per tier and grade, that an offer moves FROM. */
  let priceSheet: Record<string, number>;
  const key = (tier: string, condition: string | null) => `${tier}:${condition ?? ''}`;

  const build = () => {
    saved = [];
    priceSheet = {
      [key(PricingTier.INDIVIDUAL, null)]: 100,
      [key(PricingTier.COMPANY, null)]: 90,
      [key(PricingTier.FACTORY, null)]: 80,
      [key(PricingTier.FREE_FACILITY, null)]: 80,
      [key(PricingTier.FACTORY, 'EXCELLENT')]: 70,
      [key(PricingTier.FACTORY, 'GOOD')]: 60,
      [key(PricingTier.FREE_FACILITY, 'EXCELLENT')]: 70,
      [key(PricingTier.FREE_FACILITY, 'GOOD')]: 60,
    };

    productRepo = {
      findOne: jest.fn().mockResolvedValue({ id: GRADED, odooProductId: 42, isActive: true }),
    };
    offerRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: `off-${saved.length + 1}`, ...x })),
      findOne: jest.fn(),
      delete: jest.fn(),
    };
    // HONOURS the tier and condition it is asked for. A sheet that answered
    // every question with one number could not show that the base price depends
    // on which grade and which buyer — which is the entire subject here, and a
    // test built on it would pass whatever the code compared against.
    pricingRepo = {
      createQueryBuilder: jest.fn(() => {
        const state: { tier: string | null; condition: string | null } = {
          tier: null,
          condition: null,
        };
        const qb: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn((clause: string, params: any) => {
            if (params?.tier) state.tier = params.tier;
            if (params?.conditionCode) state.condition = params.conditionCode;
            if (/conditionCode IS NULL/.test(clause)) state.condition = null;
            return qb;
          }),
          orderBy: jest.fn().mockReturnThis(),
          getOne: jest.fn(async () => {
            const price = priceSheet[key(state.tier as string, state.condition)];
            return price == null ? null : { price: String(price) };
          }),
        };
        return qb;
      }),
    };
    conditions = {
      hasConditions: jest.fn().mockResolvedValue(true),
      validateActiveCode: jest.fn(async (_p: string, c: string) => c.toUpperCase()),
      // Every grade of the material, for the case where ONE amount is given and
      // has to be applied — and separately checked — against each of them.
      activeForProduct: jest.fn(async () => [
        { id: 'cond-excellent', code: 'EXCELLENT' },
        { id: 'cond-good', code: 'GOOD' },
      ]),
      // Resolves an ID against the material and hands back the row, so the
      // service copies the CODE from what it resolved rather than trusting one
      // sent alongside it.
      resolveActiveById: jest.fn(async (_p: string, id: string) => {
        const code = String(id).replace(/^cond-/, '').toUpperCase();
        if (!['EXCELLENT', 'GOOD'].includes(code)) {
          throw new BadRequestException('unknown condition for this material');
        }
        return { id, code };
      }),
    };
    odooSync = { enqueueUpdatePricing: jest.fn() };
    const noop = { invalidate: jest.fn(), record: jest.fn() };
    const dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({
          getRepository: () => ({
            create: offerRepo.create,
            save: async (x: any) => {
              const row = await offerRepo.save(x);
              saved.push(row);
              return row;
            },
          }),
        }),
      ),
    };

    service = new AdminCatalogService(
      {} as any, productRepo, {} as any, {} as any, {} as any, {} as any,
      pricingRepo, offerRepo, odooSync as any, noop as any, noop as any,
      {} as any, conditions, dataSource as any,
    );
  };

  beforeEach(build);

  const create = (over: any = {}) =>
    service.createOffer('admin-1', { product_id: GRADED, ...over } as any);

  // ══════════════════════════════════════════════════════════════════
  // The audience decides the DIRECTION
  // ══════════════════════════════════════════════════════════════════
  it('stores a seller offer as an amount ADDED to their price', async () => {
    // Citizens list at 100 and institutions at 90; +10 is a 10% rise on the
    // smaller of the two, which is what every targeted seller is guaranteed.
    const res: any = await create({ audience: OfferAudience.SELLERS, amount: 10 });

    expect(res.offers).toHaveLength(1);
    expect(saved[0].audience).toBe(OfferAudience.SELLERS);
    expect(Number(saved[0].amount)).toBe(10);
    // Naming no role means BOTH, and it is stored EXPANDED rather than left
    // empty. A query asking "which offers reach institutions?" then answers
    // from the column instead of having to know the audience rule.
    expect(saved[0].targetRoles).toEqual([Role.CITIZEN, Role.INSTITUTIONS]);
  });

  it('lets a seller amount exceed the price — it is a rise, not a cut', async () => {
    // The negative-price rule is about BUYERS only. Adding 500 to what a
    // citizen is paid is generous, not impossible, and refusing it would apply
    // a buyer's arithmetic to the opposite side of the trade.
    await expect(
      create({ audience: OfferAudience.SELLERS, amount: 500 }),
    ).resolves.toBeDefined();
  });

  it('refuses a role from the other side of the trade', async () => {
    // Silently dropping it would leave the admin believing factories were
    // covered by an offer that only ever reached citizens.
    await expect(
      create({
        audience: OfferAudience.SELLERS,
        target_roles: [Role.CITIZEN, Role.FACTORY],
        amount: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('narrows a seller offer to ONE role when asked', async () => {
    const res: any = await create({
      audience: OfferAudience.SELLERS,
      target_roles: [Role.INSTITUTIONS],
      amount: 10,
    });

    expect(res.offers).toHaveLength(1);
    // Measured against the INSTITUTION price of 90 alone — 11.11% — not
    // against the citizen price it does not touch.
    expect(Number(saved[0].discountPercentage)).toBeCloseTo(11.11, 1);
    expect(saved[0].targetRoles).toEqual([Role.INSTITUTIONS]);
  });

  // ══════════════════════════════════════════════════════════════════
  // Only buyers have grades
  // ══════════════════════════════════════════════════════════════════
  it('refuses a grade on a SELLER offer', async () => {
    // A citizen is paid when the material is handed in, before it is sorted —
    // there is no grade yet to price, so the request describes a distinction
    // their price list does not have.
    await expect(
      create({
        audience: OfferAudience.SELLERS,
        amount: 10,
        conditions: [{ condition_id: 'cond-excellent', amount: 10 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a grade on a material that has none', async () => {
    conditions.hasConditions.mockResolvedValue(false);

    await expect(
      create({
        audience: OfferAudience.BUYERS,
        conditions: [{ condition_id: 'cond-excellent', amount: 10 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('takes one flat amount for buyers when the material has NO grades', async () => {
    conditions.hasConditions.mockResolvedValue(false);

    const res: any = await create({ audience: OfferAudience.BUYERS, amount: 10 });

    expect(res.offers).toHaveLength(1);
    expect(saved[0].conditionCode).toBeNull();
    expect(saved[0].conditionId).toBeNull();
  });

  it('accepts SEVERAL grades of the same material, each with its own amount', async () => {
    const res: any = await create({
      audience: OfferAudience.BUYERS,
      conditions: [
        { condition_id: 'cond-excellent', amount: 20 },
        { condition_id: 'cond-good', amount: 10 },
      ],
    });

    expect(res.offers).toHaveLength(2);
    expect(saved.map((o) => o.conditionCode).sort()).toEqual(['EXCELLENT', 'GOOD']);
    expect(saved.map((o) => Number(o.amount))).toEqual([20, 10]);
  });

  it('applies ONE amount to EVERY grade when none is named', async () => {
    // Naming no grade is not an error and not "the flat price" — a graded
    // material has no flat buyer price. It means all of them.
    const res: any = await create({ audience: OfferAudience.BUYERS, amount: 10 });

    expect(res.offers).toHaveLength(2);
    expect(saved.map((o) => o.conditionCode).sort()).toEqual(['EXCELLENT', 'GOOD']);
  });

  it('refuses the same grade listed twice', async () => {
    // Two amounts for one grade have no defined winner, so the buyer's quote
    // would depend on nothing they can see.
    await expect(
      create({
        audience: OfferAudience.BUYERS,
        conditions: [
          { condition_id: 'cond-excellent', amount: 20 },
          { condition_id: 'cond-excellent', amount: 10 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks every grade belongs to THIS material', async () => {
    // A code alone names nothing — two materials may each have a "GOOD" — and
    // an offer filed under another material's grade would never match a cart
    // line, so it would simply never apply to anything.
    await expect(
      create({
        audience: OfferAudience.BUYERS,
        conditions: [{ condition_id: 'cond-from-another-material', amount: 10 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores the grade’s ID, not only its code', async () => {
    // The code is not an identifier — it is unique only inside its own
    // material — so the id is the link, and the foreign key behind it is what
    // stops a grade being deleted while a live offer names it.
    await create({
      audience: OfferAudience.BUYERS,
      conditions: [{ condition_id: 'cond-excellent', amount: 10 }],
    });

    expect(saved[0].conditionId).toBe('cond-excellent');
    expect(saved[0].conditionCode).toBe('EXCELLENT');
  });

  it('copies the code FROM the resolved grade, never from the request', async () => {
    // Sent alongside, a code could disagree with the id — and the code is the
    // join key the price sheet and the basket use, so the offer would match
    // the wrong price while looking correct.
    await create({
      audience: OfferAudience.BUYERS,
      conditions: [
        { condition_id: 'cond-excellent', amount: 10, condition: 'GOOD' } as any,
      ],
    });

    expect(saved[0].conditionCode).toBe('EXCELLENT');
  });

  it('leaves the grade link empty on a seller row', async () => {
    // A seller row names no grade, so it must hold no link either — a dangling
    // one would block that grade from ever being deleted.
    await create({ audience: OfferAudience.SELLERS, amount: 10 });

    expect(saved[0].conditionId).toBeNull();
    expect(saved[0].conditionCode).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════
  // The amount can never drive a price negative
  // ══════════════════════════════════════════════════════════════════
  it('refuses a buyer amount equal to the grade’s price', async () => {
    // Factory "excellent" lists at 70. Taking 70 off is not a free material,
    // it is a price of zero — nothing is being sold.
    await expect(
      create({
        audience: OfferAudience.BUYERS,
        conditions: [{ condition_id: 'cond-excellent', amount: 70 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('names the offending grade when one amount is spread over all of them', async () => {
    // 65 is a fair cut off "excellent" at 70 and would take "good" at 60 to
    // MINUS five — paying the factory to take the material away. The message
    // has to say which grade, or the admin cannot tell what to change.
    await expect(
      create({ audience: OfferAudience.BUYERS, amount: 65 }),
    ).rejects.toThrow(/GOOD/);
  });

  it('explains the loss rather than only refusing', async () => {
    await expect(
      create({ audience: OfferAudience.BUYERS, amount: 65 }),
    ).rejects.toThrow(/zero or below|paying the buyer/i);
  });

  it('checks a buyer amount against the CHEAPEST tier it faces', async () => {
    // A buyer row faces both FACTORY and FREE_FACILITY. Make the free-facility
    // grade cheaper than the factory one and an amount that clears the factory
    // must still be refused — the row reaches both.
    priceSheet[key(PricingTier.FREE_FACILITY, 'EXCELLENT')] = 15;

    await expect(
      create({
        audience: OfferAudience.BUYERS,
        conditions: [{ condition_id: 'cond-excellent', amount: 20 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an offer on a material with no live price to move', async () => {
    priceSheet = {};

    await expect(
      create({ audience: OfferAudience.SELLERS, amount: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ══════════════════════════════════════════════════════════════════
  // The percentage is DERIVED
  // ══════════════════════════════════════════════════════════════════
  it('computes the percentage from the amount and the material’s own price', async () => {
    // Factory "excellent" lists at 70; 35 off is exactly half.
    await create({
      audience: OfferAudience.BUYERS,
      conditions: [{ condition_id: 'cond-excellent', amount: 35 }],
    });

    expect(Number(saved[0].discountPercentage)).toBe(50);
  });

  it('measures each grade against ITS OWN price, not the cheapest', async () => {
    // "excellent" lists at 70 and "good" at 60. 30 off each is ~43% and 50%,
    // not one figure for both.
    await create({
      audience: OfferAudience.BUYERS,
      conditions: [
        { condition_id: 'cond-excellent', amount: 30 },
        { condition_id: 'cond-good', amount: 30 },
      ],
    });

    const byGrade = Object.fromEntries(
      saved.map((o) => [o.conditionCode, Number(o.discountPercentage)]),
    );
    expect(byGrade.EXCELLENT).toBeCloseTo(42.86, 1);
    expect(byGrade.GOOD).toBe(50);
  });

  it('reports the SMALLEST percentage across a mixed audience', async () => {
    // Citizens list at 100 and institutions at 90, so +45 is 45% for one and
    // 50% for the other. The honest headline is the one every targeted seller
    // is guaranteed to get at least.
    await create({ audience: OfferAudience.SELLERS, amount: 45 });

    expect(Number(saved[0].discountPercentage)).toBe(45);
  });

  it('ignores any percentage the caller tries to send', async () => {
    // The field is gone from the DTO; even smuggled past validation, nothing
    // reads it. Ranking by a typed percentage ranks by arithmetic, not money.
    await create({
      audience: OfferAudience.BUYERS,
      conditions: [{ condition_id: 'cond-excellent', amount: 35 }],
      discount_percentage: 99,
    });

    expect(Number(saved[0].discountPercentage)).toBe(50);
  });

  // ══════════════════════════════════════════════════════════════════
  // Odoo hears about it
  // ══════════════════════════════════════════════════════════════════
  it('pushes the material’s price sheet to Odoo on create', async () => {
    // Nothing did this before: the Odoo sheet was refreshed only when a
    // MATERIAL PRICE changed, so an offer left that screen showing the old
    // figure while the apps sold at another — for as long as nobody happened
    // to edit that material's price.
    await create({ audience: OfferAudience.SELLERS, amount: 10 });

    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: GRADED });
  });

  it('does not push a material Odoo has never seen', async () => {
    productRepo.findOne.mockResolvedValue({ id: GRADED, odooProductId: null, isActive: true });

    await create({ audience: OfferAudience.SELLERS, amount: 10 });

    expect(odooSync.enqueueUpdatePricing).not.toHaveBeenCalled();
  });

  // ══════════════════════════════════════════════════════════════════
  // One live offer per (material, grade, audience)
  // ══════════════════════════════════════════════════════════════════
  it('refuses a second live offer on the same grade and audience', async () => {
    offerRepo.find.mockResolvedValue([
      { id: 'existing', conditionCode: 'EXCELLENT', targetRoles: [Role.FACTORY] },
    ]);

    await expect(
      create({
        audience: OfferAudience.BUYERS,
        target_roles: [Role.FACTORY],
        conditions: [{ condition_id: 'cond-excellent', amount: 10 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * The two narrow edits: when an offer ends, and how much it moves the price.
 *
 * Separate routes from the general update because they are the edits made under
 * time pressure, and the general one requires re-sending the audience — where a
 * slip silently flips the direction the price moves in.
 */
describe('offer validity and amount edits', () => {
  let service: AdminCatalogService;
  let offerRepo: any;
  let productRepo: any;
  let pricingRepo: any;
  let odooSync: any;
  let cache: any;

  beforeEach(() => {
    offerRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn(async (x) => x),
      delete: jest.fn(),
    };
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1', odooProductId: 42 }) };
    pricingRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ price: '100' }),
      })),
    };
    odooSync = { enqueueUpdatePricing: jest.fn() };
    cache = { invalidate: jest.fn() };
    service = new AdminCatalogService(
      {} as any, productRepo, {} as any, {} as any, {} as any, {} as any,
      pricingRepo, offerRepo, odooSync as any, { record: jest.fn() } as any,
      cache as any, {} as any, {} as any, {} as any,
    );
  });

  const existing = (over: any = {}) => ({
    id: 'off-1',
    productId: 'p1',
    audience: OfferAudience.BUYERS,
    amount: '50',
    discountPercentage: '10',
    conditionId: null,
    conditionCode: null,
    targetRoles: [Role.FACTORY],
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: new Date('2026-06-01T00:00:00Z'),
    ...over,
  });

  // ── validity ──────────────────────────────────────────────────────
  it('extends an offer that is about to lapse', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOfferValidity('a', 'off-1', {
      valid_until: '2026-12-31T00:00:00Z',
    } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ validUntil: new Date('2026-12-31T00:00:00Z') }),
    );
  });

  it('clears the end date to make an offer open-ended', async () => {
    // `null` must mean something different from omitted, or an offer that once
    // had an end date could never lose it.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOfferValidity('a', 'off-1', { valid_until: null } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ validUntil: undefined }),
    );
  });

  it('refuses a window that ends before it starts', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await expect(
      service.updateOfferValidity('a', 'off-1', {
        valid_until: '2025-01-01T00:00:00Z',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears the caches every reader of an offer uses', async () => {
    // A window change that left them would keep quoting an expired offer.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOfferValidity('a', 'off-1', { valid_until: null } as any);

    expect(cache.invalidate).toHaveBeenCalledWith('offers', 'products');
  });

  it('tells Odoo when the window moves', async () => {
    // Shortening an offer ends it early; Odoo's sheet has to stop striking the
    // list price through at the same moment the apps stop discounting it.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOfferValidity('a', 'off-1', { valid_until: null } as any);

    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
  });

  // ── amount ────────────────────────────────────────────────────────
  it('changes the amount and re-derives the percentage', async () => {
    // The list price is 100, so 40 off is 40%. Leaving the stored 10% would
    // advertise a saving this amount does not give.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOfferAmount('a', 'off-1', { amount: 40 } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '40', discountPercentage: '40' }),
    );
  });

  it('refuses an amount that would take the price to zero or below', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await expect(
      service.updateOfferAmount('a', 'off-1', { amount: 100 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves the window in the SAME request as the amount', async () => {
    // Two calls would leave the offer live at the new amount on the old dates
    // in between — long enough for a real order to be priced by it.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOfferAmount('a', 'off-1', {
      amount: 40,
      valid_until: '2026-12-31T00:00:00Z',
    } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '40',
        validUntil: new Date('2026-12-31T00:00:00Z'),
      }),
    );
  });

  it('refuses an amount edit that also ends the offer before it starts', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await expect(
      service.updateOfferAmount('a', 'off-1', {
        amount: 40,
        valid_until: '2025-01-01T00:00:00Z',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves the window alone when only the amount is sent', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOfferAmount('a', 'off-1', { amount: 40 } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ validUntil: new Date('2026-06-01T00:00:00Z') }),
    );
  });

  it('tells Odoo when the amount moves', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOfferAmount('a', 'off-1', { amount: 40 } as any);

    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
  });

  // ── delete ────────────────────────────────────────────────────────
  it('tells Odoo when an offer is deleted', async () => {
    // Expressed by the offer's ABSENCE on the next read, which is the same
    // path an expiry takes — one behaviour, not two.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.deleteOffer('a', 'off-1');

    expect(offerRepo.delete).toHaveBeenCalledWith('off-1');
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
  });
});
