import { NotFoundException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * Unit tests for PricingService — the 4-tier admin pricing logic.
 * Repositories and collaborators are mocked; no DB/Redis required.
 */
describe('PricingService', () => {
  let service: PricingService;

  let productRepo: any;
  let pricingRepo: any;
  let cartItemRepo: any;
  let odooSync: any;
  let audit: any;
  let cache: any;
  let updateQb: any;

  const dto = {
    individual: 0.3,
    company: 0.27,
    factory: 0.25,
    free_facility: 0.26,
  };

  beforeEach(() => {
    updateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };

    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }) };
    pricingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(updateQb),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'pp', ...x })),
      find: jest.fn().mockResolvedValue([]),
    };
    cartItemRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn((x) => Promise.resolve(x)) };
    odooSync = { enqueueUpdatePricing: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };

    service = new PricingService(productRepo, pricingRepo, cartItemRepo, odooSync, audit, cache);
  });

  describe('setPricing', () => {
    it('throws NotFound when the product does not exist', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.setPricing('admin1', 'missing', dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('persists all four tiers and returns them', async () => {
      const result = await service.setPricing('admin1', 'p1', dto);

      // one create+save and one close-out query builder per tier (4 tiers)
      expect(pricingRepo.save).toHaveBeenCalledTimes(4);
      expect(pricingRepo.createQueryBuilder).toHaveBeenCalledTimes(4);

      expect(result.pricing).toEqual({
        individual: 0.3,
        company: 0.27,
        factory: 0.25,
        free_facility: 0.26,
      });
    });

    it('saves a FREE_FACILITY pricing row distinct from FACTORY', async () => {
      await service.setPricing('admin1', 'p1', dto);

      const savedTiers = pricingRepo.save.mock.calls.map((c: any[]) => c[0]);
      const freeFacility = savedTiers.find((r: any) => r.tier === PricingTier.FREE_FACILITY);
      const factory = savedTiers.find((r: any) => r.tier === PricingTier.FACTORY);

      expect(freeFacility).toBeDefined();
      expect(freeFacility.price).toBe('0.26');
      expect(factory.price).toBe('0.25');
    });

    it('enqueues an Odoo sync job and writes an audit log', async () => {
      await service.setPricing('admin1', 'p1', dto);
      expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });

    it('re-prices active (non-offer) cart lines using each owner tier', async () => {
      cartItemRepo.find.mockResolvedValueOnce([
        {
          id: 'ci1',
          productId: 'p1',
          isOffer: false,
          quantity: '2',
          unitPrice: '0',
          subtotal: '0',
          cart: { account: { role: Role.CITIZEN } },
        },
      ]);

      const result = await service.setPricing('admin1', 'p1', dto);

      expect(result.updated_cart_items).toBe(1);
      const savedItem = cartItemRepo.save.mock.calls[0][0];
      expect(savedItem.unitPrice).toBe('0.3'); // CITIZEN -> individual tier
      expect(savedItem.subtotal).toBe('0.6');
    });
  });

  describe('getPriceHistory', () => {
    it('groups rows per tier and flags the current price', async () => {
      productRepo.findOne.mockResolvedValueOnce({ id: 'p1' });
      const past = new Date(Date.now() - 86400000);
      const future = new Date(Date.now() + 86400000);
      pricingRepo.find.mockResolvedValueOnce([
        { tier: PricingTier.INDIVIDUAL, price: '0.30', currency: 'JOD', effectiveFrom: past, effectiveUntil: null },
        { tier: PricingTier.INDIVIDUAL, price: '0.20', currency: 'JOD', effectiveFrom: new Date('2020-01-01'), effectiveUntil: past },
        { tier: PricingTier.FACTORY, price: '0.25', currency: 'JOD', effectiveFrom: past, effectiveUntil: future },
      ]);

      const result: any = await service.getPriceHistory('p1');

      expect(result.product_id).toBe('p1');
      expect(result.tiers.individual.current).toBe(0.3);
      expect(result.tiers.individual.history).toHaveLength(2);
      expect(result.tiers.factory.current).toBe(0.25);
      expect(result.tiers.free_facility.current).toBeNull();
    });

    it('throws NotFound when the product is missing', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.getPriceHistory('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
