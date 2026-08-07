import { OfferSettlementService } from './offer-settlement.service';
import { OfferAudience } from '../../enums/offer-audience.enum';
import { PricingTier } from '../../enums/pricing-tier.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * What happens to a material's OFFERS when its PRICE moves.
 *
 * An offer stores an amount, and an amount only means something against the
 * price it is applied to. So changing a price silently changes every offer on
 * that material — in two ways, one cosmetic and one dangerous:
 *
 *   the stored PERCENTAGE goes stale. "20% off" was computed against the old
 *   price and is simply wrong against the new one — and it is what every
 *   "biggest offers" list ranks by;
 *
 *   the AMOUNT may no longer fit. Drop a price from 10 to 3 while a buyer offer
 *   takes 4 off it and the price is not small, it is NEGATIVE, which means
 *   paying the buyer to take the material away.
 *
 * The price is the primary fact and is never refused: an administrator setting
 * a price should not be blocked by an offer they may have forgotten about. The
 * offer gives way instead — suspended, with the reason recorded, so somebody
 * can see what happened rather than discovering it as a negative invoice.
 */
describe('a price change re-settles the offers on that material', () => {
  let service: OfferSettlementService;
  let offerRepo: any;
  let pricingRepo: any;
  let audit: any;

  const P = 'prod-1';

  /** The prices in force AFTER the change, per tier and grade. */
  let sheet: Record<string, number>;
  const key = (tier: string, code: string | null) => `${tier}:${code ?? ''}`;

  const offer = (over: any = {}) => ({
    id: 'off-1',
    productId: P,
    audience: OfferAudience.BUYERS,
    amount: '4',
    discountPercentage: '40',
    conditionCode: null,
    targetRoles: null,
    isActive: true,
    ...over,
  });

  beforeEach(() => {
    sheet = {
      [key(PricingTier.INDIVIDUAL, null)]: 10,
      [key(PricingTier.COMPANY, null)]: 10,
      [key(PricingTier.FACTORY, null)]: 10,
      [key(PricingTier.FREE_FACILITY, null)]: 10,
    };

    offerRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (x: any) => x),
    };
    // Answers for the tier and grade it is ASKED about. A repository that
    // returned one number regardless could not show that an amount fits one
    // tier and not another, which is the whole subject here.
    pricingRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        const code =
          where.conditionCode && typeof where.conditionCode === 'string'
            ? where.conditionCode
            : null;
        const price = sheet[key(where.tier, code)];
        if (price == null) return null;
        return {
          price: String(price),
          effectiveFrom: new Date(Date.now() - 86_400_000),
          effectiveUntil: null,
        };
      }),
    };
    audit = { record: jest.fn() };

    service = new OfferSettlementService(offerRepo, pricingRepo, audit);
  });

  // ── the percentage follows the price ──────────────────────────────────
  it('re-derives the percentage against the NEW price', async () => {
    // 4 off 10 was 40%. The price is now 20, so the same 4 is 20% — leaving
    // 40% would advertise a saving twice the size of the one on offer.
    offerRepo.find.mockResolvedValue([offer()]);
    for (const t of Object.keys(sheet)) sheet[t] = 20;

    const out = await service.resettle(P, 'admin-1');

    expect(out.repriced).toBe(1);
    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ discountPercentage: '20' }),
    );
  });

  it('writes nothing when the percentage is unchanged', async () => {
    // A price edit that does not move this offer's arithmetic must not touch
    // the row: a needless save bumps `updated_at` and makes an audit trail read
    // as though somebody changed the offer.
    offerRepo.find.mockResolvedValue([offer({ discountPercentage: '40' })]);

    const out = await service.resettle(P, 'admin-1');

    expect(out).toEqual({ repriced: 0, suspended: 0 });
    expect(offerRepo.save).not.toHaveBeenCalled();
  });

  it('measures against the DEAREST tier the offer faces', async () => {
    // A buyer offer reaches factories and free facilities. At 20 and 40, the
    // same 4 off is 20% for one and 10% for the other; the honest figure is the
    // one every targeted buyer is guaranteed to get at least.
    offerRepo.find.mockResolvedValue([offer()]);
    sheet[key(PricingTier.FACTORY, null)] = 20;
    sheet[key(PricingTier.FREE_FACILITY, null)] = 40;

    await service.resettle(P, 'admin-1');

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ discountPercentage: '10' }),
    );
  });

  // ── the amount that no longer fits ────────────────────────────────────
  it('suspends a buyer offer whose amount no longer fits the price', async () => {
    // 4 off a price of 3 is MINUS one — paying the buyer to take it away.
    offerRepo.find.mockResolvedValue([offer()]);
    sheet[key(PricingTier.FACTORY, null)] = 3;

    const out = await service.resettle(P, 'admin-1');

    expect(out.suspended).toBe(1);
    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
  });

  it('suspends when the amount EQUALS the price', async () => {
    // A price of zero is not a free material, it is nothing being sold.
    offerRepo.find.mockResolvedValue([offer({ amount: '10' })]);

    const out = await service.resettle(P, 'admin-1');

    expect(out.suspended).toBe(1);
  });

  it('records WHY, against the admin who moved the price', async () => {
    // Without this the offer simply stops one day and nobody can tell whether
    // it lapsed, was withdrawn, or was taken down by a price edit.
    offerRepo.find.mockResolvedValue([offer()]);
    sheet[key(PricingTier.FACTORY, null)] = 3;

    await service.resettle(P, 'admin-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'SUSPEND_OFFER_PRICE_TOO_LOW',
        entityId: 'off-1',
        newValues: expect.objectContaining({ newBasePrice: 3, tier: PricingTier.FACTORY }),
      }),
    );
  });

  it('leaves an already-suspended offer alone', async () => {
    // Re-suspending would write a second audit entry every time any price on
    // the material moved, burying the one that explains what happened.
    offerRepo.find.mockResolvedValue([offer({ isActive: false })]);
    sheet[key(PricingTier.FACTORY, null)] = 3;

    const out = await service.resettle(P, 'admin-1');

    expect(out.suspended).toBe(0);
    expect(offerRepo.save).not.toHaveBeenCalled();
  });

  it('never suspends a SELLER offer, however large the amount', async () => {
    // The negative-price rule belongs to buyers. Adding 4 to what a citizen is
    // paid stays valid whatever their price falls to — applying the buyer's
    // arithmetic here would take down a perfectly good offer.
    offerRepo.find.mockResolvedValue([
      offer({ audience: OfferAudience.SELLERS, amount: '400' }),
    ]);
    sheet[key(PricingTier.INDIVIDUAL, null)] = 1;
    sheet[key(PricingTier.COMPANY, null)] = 1;

    const out = await service.resettle(P, 'admin-1');

    expect(out.suspended).toBe(0);
  });

  // ── tiers the material is not sold to ─────────────────────────────────
  it('ignores a tier the material has no price for', async () => {
    // A missing price is not a breach — the material simply is not sold to
    // that tier, and the catalogue already hides it from those buyers.
    // Treating it as a break would suspend every offer on a material priced
    // for only one of its two audiences.
    offerRepo.find.mockResolvedValue([offer()]);
    delete sheet[key(PricingTier.FREE_FACILITY, null)];

    const out = await service.resettle(P, 'admin-1');

    expect(out.suspended).toBe(0);
  });

  it('checks only the tier a narrowed offer actually reaches', async () => {
    // Targeted at factories alone, a collapse in the free-facility price is
    // none of its business.
    offerRepo.find.mockResolvedValue([offer({ targetRoles: [Role.FACTORY] })]);
    sheet[key(PricingTier.FREE_FACILITY, null)] = 1;

    const out = await service.resettle(P, 'admin-1');

    expect(out.suspended).toBe(0);
  });

  // ── graded offers ─────────────────────────────────────────────────────
  it('reads the price of the GRADE the offer names', async () => {
    // Measured against the material's flat price instead, a graded offer would
    // be judged on a number its buyers never pay.
    offerRepo.find.mockResolvedValue([offer({ conditionCode: 'GOOD' })]);
    sheet[key(PricingTier.FACTORY, 'GOOD')] = 8;
    sheet[key(PricingTier.FREE_FACILITY, 'GOOD')] = 8;

    await service.resettle(P, 'admin-1');

    // 4 off 8 is 50%, not the 40% the flat price of 10 would have given.
    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ discountPercentage: '50' }),
    );
  });

  // ── an unattributed change ────────────────────────────────────────────
  it('records a system actor when no admin is named', async () => {
    // The audit row has a NOT NULL author, so a background reprice with no
    // admin behind it must still be attributable rather than failing to write.
    offerRepo.find.mockResolvedValue([offer()]);
    sheet[key(PricingTier.FACTORY, null)] = 3;

    await service.resettle(P);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'system' }),
    );
  });
});
