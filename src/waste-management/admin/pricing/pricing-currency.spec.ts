import { BadRequestException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';

/**
 * Editing a price's CURRENCY.
 *
 * A currency change is a label change, not a price change: the figure stays
 * exactly as it was, quoted now in a different currency. So it edits the live
 * rows IN PLACE — never archiving them, never touching the history table, and
 * never re-pricing carts or re-settling offers, none of which the number moving
 * would have triggered.
 *
 * Two doors: one price row by its id (`correctPricingRow`), and the whole
 * current list of a material (`updateCurrentCurrency`).
 */
describe('PricingService — currency edits', () => {
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
    );
  });

  const liveRow = (over: any = {}) => ({
    id: 'pp1',
    productId: 'p1',
    tier: PricingTier.FACTORY,
    conditionCode: 'EXCELLENT',
    conditionId: 'c1',
    price: '0.25',
    currency: 'JOD',
    effectiveFrom: new Date(Date.now() - 1000),
    effectiveUntil: null,
    ...over,
  });

  // Chainable query-builder returning fixed live rows (for updateCurrentCurrency).
  const liveRowsQb = (rows: any[]) =>
    jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    }));

  // ── by single pricing id ──────────────────────────────────────────────────
  describe('correctPricingRow', () => {
    it('changes ONLY the currency — no reprice, no resettle, price untouched', async () => {
      const row = liveRow();
      pricingRepo.findOne.mockResolvedValue(row);

      const res = await service.correctPricingRow('a1', 'pp1', { currency: 'usd' as any });

      expect(row.currency).toBe('usd'); // (DTO uppercases before the service; here it is passed through)
      expect(row.price).toBe('0.25'); // unchanged
      expect(cartItemRepo.find).not.toHaveBeenCalled(); // repriceTier never ran
      expect(offerSettlement.resettle).not.toHaveBeenCalled();
      expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
      expect(res.currency).toBe('usd');
      expect(res.updated_cart_items).toBe(0);
    });

    it('changes the price and DOES reprice + resettle', async () => {
      const row = liveRow();
      pricingRepo.findOne.mockResolvedValue(row);

      const res = await service.correctPricingRow('a1', 'pp1', { price: 0.3 });

      expect(row.price).toBe('0.3');
      expect(cartItemRepo.find).toHaveBeenCalled(); // repriceTier ran
      expect(offerSettlement.resettle).toHaveBeenCalledWith('p1', 'a1');
      expect(res.price).toBe(0.3);
    });

    it('changes both price and currency together', async () => {
      const row = liveRow();
      pricingRepo.findOne.mockResolvedValue(row);

      const res = await service.correctPricingRow('a1', 'pp1', { price: 0.4, currency: 'EUR' });
      expect(row.price).toBe('0.4');
      expect(row.currency).toBe('EUR');
      expect(res.price).toBe(0.4);
      expect(res.currency).toBe('EUR');
    });

    it('refuses an empty correction (neither price nor currency)', async () => {
      pricingRepo.findOne.mockResolvedValue(liveRow());
      await expect(service.correctPricingRow('a1', 'pp1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses correcting a SUPERSEDED (expired) row', async () => {
      pricingRepo.findOne.mockResolvedValue(
        liveRow({ effectiveUntil: new Date(Date.now() - 500) }),
      );
      await expect(
        service.correctPricingRow('a1', 'pp1', { currency: 'USD' }),
      ).rejects.toThrow(/currently in force|superseded/i);
    });
  });

  // ── whole current list of a material ───────────────────────────────────────
  describe('updateCurrentCurrency', () => {
    it('re-denominates EVERY live row and never touches history', async () => {
      const rows = [
        { id: 'r1', tier: PricingTier.INDIVIDUAL, currency: 'JOD', conditionCode: null },
        { id: 'r2', tier: PricingTier.FACTORY, currency: 'JOD', conditionCode: 'EXCELLENT' },
      ];
      pricingRepo.createQueryBuilder = liveRowsQb(rows);

      const res = await service.updateCurrentCurrency('a1', 'p1', 'USD');

      expect(rows.every((r) => r.currency === 'USD')).toBe(true);
      expect(pricingRepo.save).toHaveBeenCalledWith(rows);
      expect(historyRepo.save).not.toHaveBeenCalled(); // past history untouched
      expect(res.rows_affected).toBe(2);
      expect(res.currency).toBe('USD');
      expect(res.tier).toBe('all');
    });

    it('re-denominates ONLY the named tier, leaving the others in their currency', async () => {
      const rows = [
        { id: 'r1', tier: PricingTier.INDIVIDUAL, currency: 'JOD', conditionCode: null },
        { id: 'r2', tier: PricingTier.FACTORY, currency: 'JOD', conditionCode: 'EXCELLENT' },
      ];
      pricingRepo.createQueryBuilder = liveRowsQb(rows);

      const res = await service.updateCurrentCurrency('a1', 'p1', 'USD', PricingTier.FACTORY);

      expect(rows.find((r) => r.tier === PricingTier.FACTORY)!.currency).toBe('USD');
      expect(rows.find((r) => r.tier === PricingTier.INDIVIDUAL)!.currency).toBe('JOD');
      expect(res.rows_affected).toBe(1);
      expect(res.tier).toBe('factory');
    });

    it('refuses when the material has no live price', async () => {
      pricingRepo.createQueryBuilder = liveRowsQb([]);
      await expect(
        service.updateCurrentCurrency('a1', 'p1', 'USD'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
