import { BadRequestException } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service';
import { OfferSettlementService } from '../common/providers/offer-settlement.service';
import { Role } from '@src/user/enums/role.enum';
import { PricingTier } from '../enums/pricing-tier.enum';
import { OfferAudience } from '../enums/offer-audience.enum';
import { OfferBasis } from '../enums/offer-basis.enum';
import { PricingService } from './pricing/pricing.service';

/**
 * An offer can be stated as an AMOUNT or as a PERCENTAGE, and the difference
 * only shows up LATER — when the material's price is edited.
 *
 * Both store an amount, because everything downstream applies one. What differs
 * is which number was the promise:
 *
 *   "5 off"    — the 5 is the promise. The list price rising from 80 to 100
 *                leaves it 5 off, now 95.
 *   "25% off"  — the quarter is the promise. The same rise must recompute the
 *                amount to 25, or a quarter off quietly decays into a fifth.
 *
 * That is the entire reason the basis is stored rather than thrown away once
 * the amount has been worked out.
 */
describe('offer basis — amount vs percentage', () => {
  const GRADED = 'prod-1';

  // ── creation ────────────────────────────────────────────────────────────
  describe('creating', () => {
    let service: AdminCatalogService;
    let saved: any[];
    let priceSheet: Record<string, number>;

    const key = (tier: string, condition: string | null) =>
      `${tier}:${condition ?? ''}`;

    beforeEach(() => {
      saved = [];
      priceSheet = {
        [key(PricingTier.FACTORY, null)]: 80,
        [key(PricingTier.FREE_FACILITY, null)]: 80,
        [key(PricingTier.INDIVIDUAL, null)]: 100,
        [key(PricingTier.COMPANY, null)]: 100,
      };

      const pricingRepo = {
        createQueryBuilder: jest.fn(() => {
          const state: any = { tier: null, condition: null };
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
              const p = priceSheet[key(state.tier, state.condition)];
              return p == null ? null : { price: String(p) };
            }),
          };
          return qb;
        }),
      };
      const offerRepo = {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => ({ id: 'off-1', ...x })),
        findOne: jest.fn(),
      };
      const conditions = {
        hasConditions: jest.fn().mockResolvedValue(false),
        validateActiveCode: jest.fn(),
        activeForProduct: jest.fn(async () => []),
        gradeMapFor: jest.fn(async () => new Map()),
        resolveActiveById: jest.fn(),
      };
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
        {} as any, { findOne: jest.fn().mockResolvedValue({ id: GRADED, isActive: true }) } as any,
        {} as any, {} as any, {} as any, {} as any, pricingRepo as any,
        offerRepo as any, { enqueueUpdatePricing: jest.fn() } as any,
        noop as any, noop as any, {} as any, conditions as any, {} as any, dataSource as any, { count: jest.fn().mockResolvedValue(0) } as any,
        { find: jest.fn().mockResolvedValue([]) } as any, { createNotification: jest.fn().mockResolvedValue({ id: 'n' }), enqueueNotification: jest.fn() } as any,
      );
    });

    const create = (over: any) =>
      service.createOffer('admin-1', { product_id: GRADED, ...over } as any);

    it('turns a PERCENTAGE into an amount and keeps the ratio as the promise', async () => {
      // 25% of the buyer price of 80.
      await create({ audience: OfferAudience.BUYERS, percentage: 25 });

      expect(saved[0].basis).toBe(OfferBasis.PERCENTAGE);
      expect(Number(saved[0].basisPercentage)).toBe(25);
      expect(Number(saved[0].amount)).toBe(20);
    });

    it('derives a seller percentage from the seller price, not the buyer one', async () => {
      // Sellers list at 100, buyers at 80 — reading the wrong sheet would pay
      // a citizen 20 more instead of 25.
      await create({ audience: OfferAudience.SELLERS, percentage: 25 });

      expect(Number(saved[0].amount)).toBe(25);
    });

    it('ignores a smuggled amount — only the percentage is read', async () => {
      // `amount` is gone from the DTO; if one is smuggled past validation the
      // service never reads it, and the stored amount comes from the percentage.
      await create({ audience: OfferAudience.BUYERS, percentage: 25, amount: 999 });

      expect(saved[0].basis).toBe(OfferBasis.PERCENTAGE);
      expect(Number(saved[0].amount)).toBe(20); // 25% of 80, not 999
    });

    it('refuses a percentage that would take a buyer price to zero', async () => {
      await expect(
        create({ audience: OfferAudience.BUYERS, percentage: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('derives each role\'s amount from that ROLE\'S OWN price', async () => {
      // The offer is split per role, so there is no "cheapest tier the row
      // faces" any more — each role gets a percentage of its own price. Factory
      // lists at 80, free-facility at 40: 50% is 40 for one and 20 for the other.
      priceSheet[key(PricingTier.FREE_FACILITY, null)] = 40;

      await create({ audience: OfferAudience.BUYERS, percentage: 50 });

      expect(saved).toHaveLength(2);
      const byRole = Object.fromEntries(saved.map((o) => [o.targetRoles[0], Number(o.amount)]));
      expect(byRole[Role.FACTORY]).toBe(40); // 50% of 80
      expect(byRole[Role.EXTERNAL_PARTNER]).toBe(20); // 50% of 40
    });
  });

  // ── a graded material with no grade named ───────────────────────────────
  //
  // The case the requirement turns on: a BUYER offer on a graded material, no
  // grade named, expressed as a percentage OR a single amount. It must reach
  // EVERY grade, and each grade's figure must be measured against ITS OWN
  // price — 25% of a 70 grade is 17.50, of a 60 grade is 15. A single flat
  // number for both would be the one thing this must not do.
  describe('graded material, no grade named — applied per grade', () => {
    let service: AdminCatalogService;
    let saved: any[];
    let priceSheet: Record<string, number>;
    const key = (tier: string, condition: string | null) =>
      `${tier}:${condition ?? ''}`;

    const GRADES = [
      { id: 'cond-excellent', code: 'EXCELLENT' },
      { id: 'cond-good', code: 'GOOD' },
    ];

    beforeEach(() => {
      saved = [];
      // Excellent lists dearer than good, so a per-grade split yields two
      // different amounts and a flat split would be caught out.
      priceSheet = {
        [key(PricingTier.FACTORY, 'EXCELLENT')]: 70,
        [key(PricingTier.FACTORY, 'GOOD')]: 60,
        [key(PricingTier.FREE_FACILITY, 'EXCELLENT')]: 70,
        [key(PricingTier.FREE_FACILITY, 'GOOD')]: 60,
        // Sellers are priced flat, per material — needed by the seller case,
        // which never enters the per-grade branch.
        [key(PricingTier.INDIVIDUAL, null)]: 100,
        [key(PricingTier.COMPANY, null)]: 100,
      };

      const pricingRepo = {
        createQueryBuilder: jest.fn(() => {
          const state: any = { tier: null, condition: null };
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
              const p = priceSheet[key(state.tier, state.condition)];
              return p == null ? null : { price: String(p) };
            }),
          };
          return qb;
        }),
      };
      const offerRepo = {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => ({ id: `off-${saved.length + 1}`, ...x })),
        findOne: jest.fn(),
      };
      const conditions = {
        hasConditions: jest.fn().mockResolvedValue(true),
        validateActiveCode: jest.fn(),
        activeForProduct: jest.fn(async () => GRADES),
        gradeMapFor: jest.fn(async () => new Map()),
        resolveActiveById: jest.fn(),
      };
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
        {} as any, { findOne: jest.fn().mockResolvedValue({ id: GRADED, isActive: true }) } as any,
        {} as any, {} as any, {} as any, {} as any, pricingRepo as any,
        offerRepo as any, { enqueueUpdatePricing: jest.fn() } as any,
        noop as any, noop as any, {} as any, conditions as any, {} as any, dataSource as any, { count: jest.fn().mockResolvedValue(0) } as any,
        { find: jest.fn().mockResolvedValue([]) } as any, { createNotification: jest.fn().mockResolvedValue({ id: 'n' }), enqueueNotification: jest.fn() } as any,
      );
    });

    const create = (over: any) =>
      service.createOffer('admin-1', { product_id: GRADED, ...over } as any);

    it('a PERCENTAGE becomes a different amount for each grade', async () => {
      await create({ audience: OfferAudience.BUYERS, percentage: 25 });

      // Two grades × two buyer roles (factory + free-facility) = four rows. Both
      // roles share this material's per-grade prices, so the amounts pair up.
      expect(saved).toHaveLength(4);
      const byGrade = Object.fromEntries(
        saved.map((o) => [o.conditionCode, Number(o.amount)]),
      );
      // 25% of 70, and 25% of 60 — not one figure for both.
      expect(byGrade.EXCELLENT).toBe(17.5);
      expect(byGrade.GOOD).toBe(15);
      // Every row keeps the percentage as its promise, so a later price edit
      // recomputes it rather than freezing the amount.
      expect(saved.every((o) => o.basis === OfferBasis.PERCENTAGE)).toBe(true);
      expect(saved.every((o) => Number(o.basisPercentage) === 25)).toBe(true);
    });

    it('keeps the derived percentage identical across grades', async () => {
      // The percentage is the promise, so every grade advertises the SAME share
      // even though the amount differs — 25% off both, 17.50 and 15.
      await create({ audience: OfferAudience.BUYERS, percentage: 25 });

      expect(saved).toHaveLength(4);
      expect(saved.every((o) => Number(o.discountPercentage) === 25)).toBe(true);
    });

    it('a SELLER percentage on a graded material is added, never split by grade below zero', async () => {
      // Sellers are not priced per grade, so a seller offer never reaches this
      // per-grade branch — it is one row, and a large percentage is a rise.
      await create({ audience: OfferAudience.SELLERS, percentage: 200 });

      // One row per seller role (citizen + institution), each flat (no grade).
      expect(saved).toHaveLength(2);
      expect(saved.every((o) => o.conditionCode === null)).toBe(true);
    });
  });

  // ── the price moves afterwards ──────────────────────────────────────────
  describe('after the material price is edited', () => {
    let settlement: OfferSettlementService;
    let offerRepo: any;
    let price: number;

    const buildOffer = (over: any) => ({
      id: 'off-1',
      productId: GRADED,
      audience: OfferAudience.BUYERS,
      targetRoles: [Role.FACTORY],
      conditionCode: null,
      amount: '20',
      discountPercentage: '25',
      basis: OfferBasis.AMOUNT,
      basisPercentage: null,
      isActive: true,
      ...over,
    });

    const settle = async (offer: any, newPrice: number) => {
      price = newPrice;
      offerRepo = {
        find: jest.fn().mockResolvedValue([offer]),
        save: jest.fn(async (x) => x),
      };
      const pricingRepo = {
        findOne: jest.fn(async () => ({ price: String(price) })),
      };
      settlement = new OfferSettlementService(
        offerRepo as any, pricingRepo as any, { record: jest.fn() } as any,
      );
      return settlement.resettle(GRADED, 'admin-1');
    };

    it('KEEPS the amount of an amount-based offer', async () => {
      const offer = buildOffer({ basis: OfferBasis.AMOUNT, amount: '5' });

      await settle(offer, 100); // was 80

      // "5 off" is still 5 off — now 5% instead of 6.25%.
      expect(Number(offer.amount)).toBe(5);
      expect(Number(offer.discountPercentage)).toBe(5);
    });

    it('RECOMPUTES the amount of a percentage-based offer', async () => {
      const offer = buildOffer({
        basis: OfferBasis.PERCENTAGE,
        basisPercentage: '25',
        amount: '20', // 25% of the old price of 80
      });

      await settle(offer, 100);

      // A quarter off 100 is 25 — leaving it at 20 would be a fifth.
      expect(Number(offer.amount)).toBe(25);
      expect(Number(offer.discountPercentage)).toBe(25);
      expect(offerRepo.save).toHaveBeenCalled();
    });

    it('saves a recomputed amount even when the percentage is unchanged', async () => {
      // The trap: the ratio is what stayed the same, so a check on the
      // percentage alone would compute the new amount and discard it.
      const offer = buildOffer({
        basis: OfferBasis.PERCENTAGE,
        basisPercentage: '25',
        amount: '20',
        discountPercentage: '25',
      });

      const res = await settle(offer, 100);

      expect(Number(offer.amount)).toBe(25);
      expect(res.repriced).toBe(1);
    });

    it('suspends a percentage offer only if its recomputed amount still will not fit', async () => {
      // A percentage can never exceed the price it is taken from, so a genuine
      // percentage offer survives any price — this pins that it is not
      // suspended by the amount it USED to hold.
      const offer = buildOffer({
        basis: OfferBasis.PERCENTAGE,
        basisPercentage: '50',
        amount: '20', // would exceed a new price of 10
      });

      const res = await settle(offer, 10);

      expect(res.suspended).toBe(0);
      expect(Number(offer.amount)).toBe(5); // 50% of 10
      expect(offer.isActive).toBe(true);
    });
  });
});

/**
 * The rules that guard an offer's edges, verified rather than assumed.
 *
 * Each of these was checked against the code and found MISSING before it was
 * written: a withdrawn material could carry an offer, its prices could still be
 * edited, and a buyer percentage of 100 or more was caught only by an
 * arithmetic guard that then complained about a number the administrator never
 * typed.
 */
describe('offer edges — withdrawn materials and the buyer ceiling', () => {
  const PRODUCT = 'prod-1';
  let service: AdminCatalogService;
  let productRow: any;

  beforeEach(() => {
    productRow = { id: PRODUCT, isActive: true };

    const pricingRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getOne: jest.fn(async () => ({ price: '100' })),
        };
        return qb;
      }),
    };
    const offerRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'off-1', ...x })),
    };
    const conditions = {
      hasConditions: jest.fn().mockResolvedValue(false),
      activeForProduct: jest.fn(async () => []),
        gradeMapFor: jest.fn(async () => new Map()),
      validateActiveCode: jest.fn(),
      resolveActiveById: jest.fn(),
    };
    const noop = { invalidate: jest.fn(), record: jest.fn() };
    const dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({ getRepository: () => ({ create: offerRepo.create, save: offerRepo.save }) }),
      ),
    };

    service = new AdminCatalogService(
      {} as any, { findOne: jest.fn(async () => productRow) } as any,
      {} as any, {} as any, {} as any, {} as any, pricingRepo as any,
      offerRepo as any, { enqueueUpdatePricing: jest.fn() } as any,
      noop as any, noop as any, {} as any, conditions as any, {} as any, dataSource as any, { count: jest.fn().mockResolvedValue(0) } as any,
        { find: jest.fn().mockResolvedValue([]) } as any, { createNotification: jest.fn().mockResolvedValue({ id: 'n' }), enqueueNotification: jest.fn() } as any,
    );
  });

  const create = (over: any) =>
    service.createOffer('admin-1', { product_id: PRODUCT, ...over } as any);

  it('refuses an offer on a withdrawn material', async () => {
    // Off the shelf: no catalogue lists it and no basket takes it, so the
    // offer would be invisible, unusable — and waiting to spring back at
    // whatever prices had moved to by the time somebody reactivated it.
    productRow.isActive = false;

    await expect(
      create({ audience: OfferAudience.BUYERS, percentage: 10 }),
    ).rejects.toThrow(/not active/i);
  });

  it('still allows one on a live material', async () => {
    await expect(
      create({ audience: OfferAudience.BUYERS, percentage: 10 }),
    ).resolves.toBeDefined();
  });

  it('refuses a buyer percentage of exactly 100', async () => {
    // The price reaches zero.
    await expect(
      create({ audience: OfferAudience.BUYERS, percentage: 100 }),
    ).rejects.toThrow(/100%/);
  });

  it('refuses a buyer percentage above 100', async () => {
    await expect(
      create({ audience: OfferAudience.BUYERS, percentage: 150 }),
    ).rejects.toThrow(/paid to take the material away/);
  });

  it('ALLOWS a seller percentage above 100 — it is a rise', async () => {
    // Paying a citizen 150% more is generous, not impossible. Applying the
    // buyer ceiling here would impose one side's arithmetic on the other.
    await expect(
      create({ audience: OfferAudience.SELLERS, percentage: 150 }),
    ).resolves.toBeDefined();
  });

  it('accepts a buyer percentage just under the ceiling', async () => {
    await expect(
      create({ audience: OfferAudience.BUYERS, percentage: 99.9 }),
    ).resolves.toBeDefined();
  });
});

/**
 * A withdrawn material: priced YES, promoted NO.
 *
 * The asymmetry is deliberate and was arrived at by getting it wrong first.
 * Blocking price edits on an inactive material looks like the safe choice until
 * you follow what an administrator must then do to correct a wrong price:
 * reactivate the material — publishing the wrong price to every buyer — and only
 * then fix it. The block forces the bad number live before it can be repaired.
 *
 * An offer is the opposite. It is a promotion, not a standing attribute, so
 * creating one on something nobody can buy promotes nothing — and it would lie
 * dormant and spring back whenever the material returned.
 */
describe('a withdrawn material', () => {
  const PRODUCT = 'prod-9';

  it('may still have its PRICES edited — withdraw, correct, republish', async () => {
    const productRepo = {
      findOne: jest.fn(async () => ({ id: PRODUCT, isActive: false })),
    };
    const svc: any = new (PricingService as any)(productRepo);

    // The guard is the only thing between the caller and the write; reaching
    // past it is what "may be priced" means.
    await expect(svc.productOrThrow(PRODUCT)).resolves.toMatchObject({
      id: PRODUCT,
      isActive: false,
    });
  });

  it('still refuses an OFFER — a promotion nobody can reach', async () => {
    const productRepo = {
      findOne: jest.fn(async () => ({ id: PRODUCT, isActive: false })),
    };
    const noop = { invalidate: jest.fn(), record: jest.fn() };
    const service = new AdminCatalogService(
      {} as any, productRepo as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, noop as any, noop as any, {} as any,
      {} as any, {} as any, {} as any, { count: jest.fn().mockResolvedValue(0) } as any,
        { find: jest.fn().mockResolvedValue([]) } as any, { createNotification: jest.fn().mockResolvedValue({ id: 'n' }), enqueueNotification: jest.fn() } as any,
    );

    await expect(
      service.createOffer('admin-1', {
        product_id: PRODUCT,
        audience: OfferAudience.BUYERS,
        percentage: 5,
      } as any),
    ).rejects.toThrow(/not active/i);
  });
});
