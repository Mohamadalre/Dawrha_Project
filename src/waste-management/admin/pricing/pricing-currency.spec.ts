import { BadRequestException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';

/**
 * Correcting a live price row IN PLACE — the typed-wrong FIGURE only.
 *
 * Currency is no longer editable per row (or per product): it is a single
 * central platform setting, so a correction touches the number and nothing
 * else. The correction is not archived (no commercial change happened), and a
 * superseded row — what past orders were charged at — cannot be corrected.
 */
describe('PricingService — price corrections', () => {
  let service: PricingService;
  let productRepo: any;
  let pricingRepo: any;
  let historyRepo: any;
  let cartItemRepo: any;
  let odooSync: any;
  let audit: any;
  let cache: any;
  let offerSettlement: any;

  beforeEach(() => {
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1', isActive: true }) };
    pricingRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((x) => x),
    };
    historyRepo = { save: jest.fn(), create: jest.fn((x) => x), find: jest.fn().mockResolvedValue([]) };
    cartItemRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn((x) => Promise.resolve(x)) };
    odooSync = { enqueueUpdatePricing: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    offerSettlement = { resettle: jest.fn().mockResolvedValue({ repriced: 0, suspended: 0 }) };

    service = new PricingService(
      productRepo, pricingRepo, historyRepo, cartItemRepo, odooSync, audit, cache,
      {} as any, {} as any, offerSettlement,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createNotification: jest.fn(), enqueueNotification: jest.fn() } as any,
      { defaultCurrency: jest.fn().mockResolvedValue('SYP') } as any,
    );
  });

  const liveRow = (over: any = {}) => ({
    id: 'pp1',
    productId: 'p1',
    tier: PricingTier.FACTORY,
    conditionCode: 'EXCELLENT',
    conditionId: 'c1',
    price: '0.25',
    currency: 'SYP',
    effectiveFrom: new Date(Date.now() - 1000),
    effectiveUntil: null,
    ...over,
  });

  it('changes the price and DOES reprice + resettle', async () => {
    const row = liveRow();
    pricingRepo.findOne.mockResolvedValue(row);

    const res = await service.correctPricingRow('a1', 'pp1', { price: 0.3 });

    expect(row.price).toBe('0.3');
    expect(cartItemRepo.find).toHaveBeenCalled(); // repriceTier ran
    expect(offerSettlement.resettle).toHaveBeenCalledWith('p1', 'a1');
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
    expect(res.price).toBe(0.3);
  });

  it('never changes the currency — a correction is figure-only', async () => {
    const row = liveRow({ currency: 'SYP' });
    pricingRepo.findOne.mockResolvedValue(row);

    const res = await service.correctPricingRow('a1', 'pp1', { price: 0.4 });

    expect(row.currency).toBe('SYP'); // untouched by the correction
    expect(res.currency).toBe('SYP');
  });

  it('refuses correcting a SUPERSEDED (expired) row', async () => {
    pricingRepo.findOne.mockResolvedValue(
      liveRow({ effectiveUntil: new Date(Date.now() - 500) }),
    );
    await expect(
      service.correctPricingRow('a1', 'pp1', { price: 0.5 }),
    ).rejects.toThrow(/currently in force|superseded/i);
  });

  it('404s a row that does not exist', async () => {
    pricingRepo.findOne.mockResolvedValue(null);
    await expect(
      service.correctPricingRow('a1', 'missing', { price: 0.5 }),
    ).rejects.toBeInstanceOf(Error);
  });
});
