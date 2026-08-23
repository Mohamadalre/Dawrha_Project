import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service';
import { Role } from '@src/user/enums/role.enum';
import { PricingTier } from '../enums/pricing-tier.enum';
import { OfferAudience } from '../enums/offer-audience.enum';

/**
 * What an offer MEANS, and therefore what may be sent to create one.
 *
 * An offer names a SIDE of the trade and a PERCENTAGE — and a percentage is the
 * ONLY size it is ever given. There is no offer aimed at everybody, because the
 * two sides move in opposite directions:
 *
 *   SELLERS — citizens and institutions — hand material in and are PAID. An
 *   offer to them is a rise: the percentage is ADDED to what they already get;
 *
 *   BUYERS — factories and free facilities — take material away and PAY. An
 *   offer to them is a reduction: the percentage comes OFF what they already pay.
 *
 * A percentage, not an amount, on purpose. One offer reaches roles priced
 * differently, and a percentage is the one figure fair to all of them — "10%
 * off" is 10% of each role's OWN price, and on a graded material 10% of EACH
 * grade's own price (a different amount per grade). The amount is DERIVED from
 * the percentage against every price the offer touches, and the percentage is
 * kept as the promise so a later price edit recomputes the amount.
 *
 * Two things follow, and everything below tests one of them:
 *
 *   a graded buyer offer applies its one percentage to EVERY grade, taken
 *   against each grade's own price;
 *
 *   a buyer percentage of 100 or more would take the price to zero or below —
 *   paying somebody to take the material away — so it is refused.
 */
describe('offer rules — audience, percentage, grades and the derived amount', () => {
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
      // Every grade of the material — a graded buyer offer applies its one
      // percentage to each of them, taken against that grade's own price.
      activeForProduct: jest.fn(async () => [
        { id: 'cond-excellent', code: 'EXCELLENT' },
        { id: 'cond-good', code: 'GOOD' },
      ]),
      gradeMapFor: jest.fn(async () => new Map()),
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
      {} as any, conditions, {} as any, dataSource as any,
      { count: jest.fn().mockResolvedValue(0) } as any,
        { find: jest.fn().mockResolvedValue([]) } as any, { createNotification: jest.fn().mockResolvedValue({ id: 'n' }), enqueueNotification: jest.fn() } as any,
    );
  };

  beforeEach(build);

  const create = (over: any = {}) =>
    service.createOffer('admin-1', { product_id: GRADED, ...over } as any);

  // ══════════════════════════════════════════════════════════════════
  // The audience decides the DIRECTION
  // ══════════════════════════════════════════════════════════════════
  it('stores a seller offer as a percentage ADDED, ONE ROW PER ROLE', async () => {
    // Citizens list at 100 and institutions at 90. Naming no role means BOTH,
    // and the offer is split into one row per role — each derived from its OWN
    // price — so the SAME 10% becomes a different amount for each.
    const res: any = await create({ audience: OfferAudience.SELLERS, percentage: 10 });

    expect(res.offers).toHaveLength(2);
    const byRole = Object.fromEntries(saved.map((o) => [o.targetRoles[0], o]));
    // 10% of 100 = 10 for the citizen, 10% of 90 = 9 for the institution — the
    // percentage is the same, the amount is not.
    expect(Number(byRole[Role.CITIZEN].amount)).toBe(10);
    expect(Number(byRole[Role.CITIZEN].discountPercentage)).toBeCloseTo(10, 1);
    expect(Number(byRole[Role.INSTITUTIONS].amount)).toBe(9);
    expect(Number(byRole[Role.INSTITUTIONS].discountPercentage)).toBeCloseTo(10, 1);
    // Each row carries exactly its own role.
    expect(saved.map((o) => o.targetRoles)).toEqual([[Role.CITIZEN], [Role.INSTITUTIONS]]);
    expect(saved.every((o) => o.audience === OfferAudience.SELLERS)).toBe(true);
  });

  it('lets a seller percentage exceed 100 — it is a rise, not a cut', async () => {
    // The negative-price rule is about BUYERS only. Adding 500% to what a
    // citizen is paid is generous, not impossible, and refusing it would apply
    // a buyer's arithmetic to the opposite side of the trade.
    await expect(
      create({ audience: OfferAudience.SELLERS, percentage: 500 }),
    ).resolves.toBeDefined();
  });

  it('refuses a role from the other side of the trade', async () => {
    // Silently dropping it would leave the admin believing factories were
    // covered by an offer that only ever reached citizens.
    await expect(
      create({
        audience: OfferAudience.SELLERS,
        target_roles: [Role.CITIZEN, Role.FACTORY],
        percentage: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('narrows a seller offer to ONE role when asked', async () => {
    const res: any = await create({
      audience: OfferAudience.SELLERS,
      target_roles: [Role.INSTITUTIONS],
      percentage: 10,
    });

    expect(res.offers).toHaveLength(1);
    // 10% of the INSTITUTION price of 90 = 9, at 10%.
    expect(Number(saved[0].amount)).toBe(9);
    expect(Number(saved[0].discountPercentage)).toBeCloseTo(10, 1);
    expect(saved[0].targetRoles).toEqual([Role.INSTITUTIONS]);
  });

  // ══════════════════════════════════════════════════════════════════
  // Only buyers have grades — and the percentage applies to all of them
  // ══════════════════════════════════════════════════════════════════
  it('takes one percentage for buyers when the material has NO grades', async () => {
    conditions.hasConditions.mockResolvedValue(false);

    const res: any = await create({ audience: OfferAudience.BUYERS, percentage: 10 });

    // One row per buyer role (factory + free-facility), each flat (no grade).
    expect(res.offers).toHaveLength(2);
    expect(saved.every((o) => o.conditionCode === null && o.conditionId === null)).toBe(true);
    // 10% of the flat buyer price of 80 = 8.
    expect(saved.every((o) => Number(o.amount) === 8)).toBe(true);
  });

  it('applies ONE percentage to EVERY grade for buyers', async () => {
    // A graded material has no flat buyer price; a buyer offer therefore lands
    // on all of its grades, for every buyer role.
    const res: any = await create({ audience: OfferAudience.BUYERS, percentage: 10 });

    // Two grades × two buyer roles = four rows.
    expect(res.offers).toHaveLength(4);
    expect(saved.map((o) => o.conditionCode).sort()).toEqual(['EXCELLENT', 'EXCELLENT', 'GOOD', 'GOOD']);
    // 10% of each grade's OWN price: 7 off EXCELLENT (70), 6 off GOOD (60).
    expect(saved.filter((o) => o.conditionCode === 'EXCELLENT').every((o) => Number(o.amount) === 7)).toBe(true);
    expect(saved.filter((o) => o.conditionCode === 'GOOD').every((o) => Number(o.amount) === 6)).toBe(true);
  });

  it('stores each grade’s ID, not only its code', async () => {
    // The code is not an identifier — it is unique only inside its own material
    // — so the id is the link, and the foreign key behind it is what stops a
    // grade being deleted while a live offer names it. The ids come from the
    // resolved grades, never from the request.
    await create({ audience: OfferAudience.BUYERS, percentage: 10 });

    const byCode = Object.fromEntries(saved.map((o) => [o.conditionCode, o.conditionId]));
    expect(byCode.EXCELLENT).toBe('cond-excellent');
    expect(byCode.GOOD).toBe('cond-good');
  });

  it('leaves the grade link empty on a seller row', async () => {
    // A seller row names no grade, so it must hold no link either — a dangling
    // one would block that grade from ever being deleted.
    await create({ audience: OfferAudience.SELLERS, percentage: 10 });

    expect(saved[0].conditionId).toBeNull();
    expect(saved[0].conditionCode).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════
  // The percentage can never drive a price to zero or below
  // ══════════════════════════════════════════════════════════════════
  it('refuses a buyer percentage of 100', async () => {
    // At 100% the price reaches zero — nothing is being sold; beyond it the
    // buyer would be paid to take the material away.
    await expect(
      create({ audience: OfferAudience.BUYERS, percentage: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('explains that a buyer offer at 100% reaches zero', async () => {
    await expect(
      create({ audience: OfferAudience.BUYERS, percentage: 100 }),
    ).rejects.toThrow(/100%|zero|paid to take/i);
  });

  it('refuses an offer on a material with no live price to move', async () => {
    priceSheet = {};

    await expect(
      create({ audience: OfferAudience.SELLERS, percentage: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ══════════════════════════════════════════════════════════════════
  // The amount is DERIVED from the percentage
  // ══════════════════════════════════════════════════════════════════
  it('derives the amount from the percentage and the material’s own price', async () => {
    // Factory "excellent" lists at 70; 50% off is exactly 35.
    await create({ audience: OfferAudience.BUYERS, percentage: 50 });

    const excellent = saved.find((o) => o.conditionCode === 'EXCELLENT');
    expect(Number(excellent.amount)).toBe(35);
    expect(Number(excellent.discountPercentage)).toBe(50);
  });

  it('applies the percentage to each grade against ITS OWN price', async () => {
    // "excellent" lists at 70 and "good" at 60. 30% off is 21 and 18 — the same
    // share, a different amount per grade.
    await create({ audience: OfferAudience.BUYERS, percentage: 30 });

    const byGrade = Object.fromEntries(
      saved
        .filter((o) => o.targetRoles?.[0] === Role.FACTORY || !o.targetRoles)
        .map((o) => [o.conditionCode, Number(o.amount)]),
    );
    expect(byGrade.EXCELLENT).toBeCloseTo(21, 5);
    expect(byGrade.GOOD).toBeCloseTo(18, 5);
    // Every row advertises the same 30%.
    expect(saved.every((o) => Number(o.discountPercentage) === 30)).toBe(true);
  });

  it('ignores a smuggled amount field — only the percentage is read', async () => {
    // `amount` is gone from the DTO; even smuggled past validation, nothing
    // reads it. The stored amount is derived from the percentage alone.
    await create({
      audience: OfferAudience.BUYERS,
      percentage: 50,
      amount: 999,
    });

    const excellent = saved.find((o) => o.conditionCode === 'EXCELLENT');
    expect(Number(excellent.amount)).toBe(35); // 50% of 70, not 999
  });

  // ══════════════════════════════════════════════════════════════════
  // Odoo hears about it
  // ══════════════════════════════════════════════════════════════════
  it('pushes the material’s price sheet to Odoo on create', async () => {
    // Nothing did this before: the Odoo sheet was refreshed only when a
    // MATERIAL PRICE changed, so an offer left that screen showing the old
    // figure while the apps sold at another — for as long as nobody happened
    // to edit that material's price.
    await create({ audience: OfferAudience.SELLERS, percentage: 10 });

    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: GRADED });
  });

  it('does not push a material Odoo has never seen', async () => {
    productRepo.findOne.mockResolvedValue({ id: GRADED, odooProductId: null, isActive: true });

    await create({ audience: OfferAudience.SELLERS, percentage: 10 });

    expect(odooSync.enqueueUpdatePricing).not.toHaveBeenCalled();
  });

  // ══════════════════════════════════════════════════════════════════
  // One live offer per (material, grade, audience)
  // ══════════════════════════════════════════════════════════════════
  it('refuses a second live offer on the same grade and audience', async () => {
    // A factory-specific offer already covers EXCELLENT. A new factory-specific
    // buyer offer lands on EXCELLENT too (its percentage applies to every
    // grade), so the two clash at the SAME level.
    offerRepo.find.mockResolvedValue([
      { id: 'existing', conditionCode: 'EXCELLENT', targetRoles: [Role.FACTORY], roleSpecific: true },
    ]);

    await expect(
      create({
        audience: OfferAudience.BUYERS,
        target_roles: [Role.FACTORY],
        percentage: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('LETS a role-specific offer coexist with a GENERAL one on the same grade', async () => {
    // A general (audience-wide) offer already covers factories on EXCELLENT.
    // Adding one TARGETED at factories is allowed — it overrides the general for
    // factories at read time, so this is not a duplicate.
    offerRepo.find.mockResolvedValue([
      { id: 'general', conditionCode: 'EXCELLENT', targetRoles: [Role.FACTORY], roleSpecific: false },
      { id: 'general2', conditionCode: 'GOOD', targetRoles: [Role.FACTORY], roleSpecific: false },
    ]);

    await expect(
      create({
        audience: OfferAudience.BUYERS,
        target_roles: [Role.FACTORY],
        percentage: 10,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a second GENERAL offer that reaches the same role and grade', async () => {
    // Two generals still clash — the override only excuses a general/specific
    // pair, never two of the same level.
    offerRepo.find.mockResolvedValue([
      { id: 'general', conditionCode: 'EXCELLENT', targetRoles: [Role.FACTORY], roleSpecific: false },
    ]);

    await expect(
      create({
        audience: OfferAudience.BUYERS,
        percentage: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * Editing an offer: its window, and its size — where size is a PERCENTAGE only,
 * exactly as on create. There is no amount input on edit either.
 */
describe('offer validity and percentage edits', () => {
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
      cache as any, {} as any, { gradeMapFor: jest.fn(async () => new Map()) } as any, {} as any, {} as any,
      { count: jest.fn().mockResolvedValue(0) } as any,
        { find: jest.fn().mockResolvedValue([]) } as any, { createNotification: jest.fn().mockResolvedValue({ id: 'n' }), enqueueNotification: jest.fn() } as any,
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

    await service.updateOffer('a', 'off-1', {
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

    await service.updateOffer('a', 'off-1', { valid_until: null } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ validUntil: undefined }),
    );
  });

  it('refuses a window that ends before it starts', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await expect(
      service.updateOffer('a', 'off-1', {
        valid_until: '2025-01-01T00:00:00Z',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears the caches every reader of an offer uses', async () => {
    // A window change that left them would keep quoting an expired offer.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOffer('a', 'off-1', { valid_until: null } as any);

    expect(cache.invalidate).toHaveBeenCalledWith('offers', 'products');
  });

  it('tells Odoo when the window moves', async () => {
    // Shortening an offer ends it early; Odoo's sheet has to stop striking the
    // list price through at the same moment the apps stop discounting it.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOffer('a', 'off-1', { valid_until: null } as any);

    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
  });

  // ── percentage ──────────────────────────────────────────────────────
  it('changes the percentage and re-derives the amount', async () => {
    // The list price is 100, so 40% off is an amount of 40. Leaving the stored
    // 10% would advertise a saving this size does not give.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOffer('a', 'off-1', { percentage: 40 } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '40', discountPercentage: '40' }),
    );
  });

  it('refuses a buyer percentage that would take the price to zero or below', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await expect(
      service.updateOffer('a', 'off-1', { percentage: 100 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves the window in the SAME request as the percentage', async () => {
    // Two calls would leave the offer live at the new size on the old dates
    // in between — long enough for a real order to be priced by it.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOffer('a', 'off-1', {
      percentage: 40,
      valid_until: '2026-12-31T00:00:00Z',
    } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '40',
        validUntil: new Date('2026-12-31T00:00:00Z'),
      }),
    );
  });

  it('refuses a percentage edit that also ends the offer before it starts', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await expect(
      service.updateOffer('a', 'off-1', {
        percentage: 40,
        valid_until: '2025-01-01T00:00:00Z',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves the window alone when only the percentage is sent', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOffer('a', 'off-1', { percentage: 40 } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ validUntil: new Date('2026-06-01T00:00:00Z') }),
    );
  });

  it('tells Odoo when the percentage moves', async () => {
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOffer('a', 'off-1', { percentage: 40 } as any);

    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
  });

  // ── deactivate / reactivate ────────────────────────────────────────
  it('deactivates an offer without deleting it, and tells Odoo', async () => {
    // The "turn it off" switch: the row survives (admin still sees it), but it
    // is no longer live, so it drops out of every buyer catalogue — and Odoo's
    // sheet is refreshed so the offer price disappears there too.
    offerRepo.findOne.mockResolvedValue(existing());

    await service.updateOffer('a', 'off-1', { is_active: false } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(offerRepo.delete).not.toHaveBeenCalled();
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
  });

  it('reactivates a switched-off offer', async () => {
    offerRepo.findOne.mockResolvedValue(existing({ isActive: false }));

    await service.updateOffer('a', 'off-1', { is_active: true } as any);

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
    );
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
