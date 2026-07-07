import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';
import { PricingArchiveReason } from '@src/waste-management/enums/pricing-archive-reason.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * Unit tests for PricingService — current-table + history-archive design.
 * Repositories and collaborators are mocked; no DB/Redis required.
 */
describe('PricingService', () => {
  let service: PricingService;

  let productRepo: any;
  let pricingRepo: any;
  let historyRepo: any;
  let cartItemRepo: any;
  let odooSync: any;
  let audit: any;
  let cache: any;

  const dto = {
    individual: 0.3,
    company: 0.27,
    factory: 0.25,
    free_facility: 0.26,
  };

  beforeEach(() => {
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }) };
    pricingRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'pp', ...x })),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    historyRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve(x)),
      find: jest.fn().mockResolvedValue([]),
    };
    cartItemRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn((x) => Promise.resolve(x)) };
    odooSync = { enqueueUpdatePricing: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };

    service = new PricingService(productRepo, pricingRepo, historyRepo, cartItemRepo, odooSync, audit, cache);
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

      // one insert (save) per tier (4 tiers)
      expect(pricingRepo.save).toHaveBeenCalledTimes(4);
      expect(result.pricing).toEqual({
        individual: 0.3,
        company: 0.27,
        factory: 0.25,
        free_facility: 0.26,
      });
    });

    it('archives the previous live rows before replacing them', async () => {
      // Every tier currently has a live row → it must be archived then removed.
      pricingRepo.find.mockResolvedValue([
        { productId: 'p1', tier: PricingTier.INDIVIDUAL, price: '0.2', currency: 'JOD', effectiveFrom: new Date() },
      ]);

      await service.setPricing('admin1', 'p1', dto);

      expect(historyRepo.save).toHaveBeenCalled();
      expect(pricingRepo.remove).toHaveBeenCalled();
      const archived = historyRepo.create.mock.calls[0][0];
      expect(archived.archivedReason).toBe(PricingArchiveReason.UPDATED);
      expect(archived.archivedBy).toBe('admin1');
    });

    it('saves a FREE_FACILITY row distinct from FACTORY', async () => {
      await service.setPricing('admin1', 'p1', dto);

      const savedTiers = pricingRepo.save.mock.calls.map((c: any[]) => c[0]);
      const freeFacility = savedTiers.find((r: any) => r.tier === PricingTier.FREE_FACILITY);
      const factory = savedTiers.find((r: any) => r.tier === PricingTier.FACTORY);

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

  describe('updateTierPrice', () => {
    it('updates a single tier, archives its previous value and reprices that tier only', async () => {
      pricingRepo.find.mockImplementation((opts: any) =>
        opts?.where?.tier === PricingTier.FACTORY
          ? Promise.resolve([{ productId: 'p1', tier: PricingTier.FACTORY, price: '0.25', currency: 'JOD', effectiveFrom: new Date() }])
          : Promise.resolve([]),
      );
      cartItemRepo.find.mockResolvedValueOnce([
        { productId: 'p1', isOffer: false, quantity: '3', cart: { account: { role: Role.FACTORY } } },
        { productId: 'p1', isOffer: false, quantity: '1', cart: { account: { role: Role.CITIZEN } } },
      ]);

      const result = await service.updateTierPrice('admin1', 'p1', PricingTier.FACTORY, { price: 0.5 });

      expect(historyRepo.save).toHaveBeenCalled();
      expect(pricingRepo.save).toHaveBeenCalledTimes(1); // only one tier inserted
      expect(result.tier).toBe('factory');
      expect(result.price).toBe(0.5);
      // only the FACTORY cart line is repriced
      expect(result.updated_cart_items).toBe(1);
    });

    it('throws NotFound when the product is missing', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateTierPrice('admin1', 'missing', PricingTier.FACTORY, { price: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deletePricing', () => {
    it('archives all live rows with reason DELETED and returns the count', async () => {
      pricingRepo.find.mockResolvedValue([
        { productId: 'p1', tier: PricingTier.INDIVIDUAL, price: '0.3', currency: 'JOD', effectiveFrom: new Date() },
      ]);

      const result = await service.deletePricing('admin1', 'p1');

      expect(historyRepo.save).toHaveBeenCalled();
      expect(pricingRepo.remove).toHaveBeenCalled();
      const archived = historyRepo.create.mock.calls[0][0];
      expect(archived.archivedReason).toBe(PricingArchiveReason.DELETED);
      expect(result.archived_rows).toBe(4); // one per tier
    });

    it('throws BadRequest when there is no active pricing', async () => {
      pricingRepo.find.mockResolvedValue([]);
      await expect(service.deletePricing('admin1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getCurrentPricing', () => {
    it('returns the live price per tier (null when unpriced)', async () => {
      pricingRepo.find.mockResolvedValueOnce([
        { tier: PricingTier.INDIVIDUAL, price: '0.30' },
        { tier: PricingTier.FACTORY, price: '0.25' },
      ]);

      const result: any = await service.getCurrentPricing('p1');

      expect(result.pricing.individual).toBe(0.3);
      expect(result.pricing.factory).toBe(0.25);
      expect(result.pricing.company).toBeNull();
      expect(result.pricing.free_facility).toBeNull();
    });
  });

  describe('getPriceHistory', () => {
    it('groups archived rows per tier', async () => {
      historyRepo.find.mockResolvedValueOnce([
        { tier: PricingTier.INDIVIDUAL, price: '0.20', currency: 'JOD', effectiveFrom: new Date(), archivedAt: new Date(), archivedReason: PricingArchiveReason.UPDATED },
        { tier: PricingTier.INDIVIDUAL, price: '0.10', currency: 'JOD', effectiveFrom: new Date(), archivedAt: new Date(), archivedReason: PricingArchiveReason.DELETED },
      ]);

      const result: any = await service.getPriceHistory('p1');

      expect(result.product_id).toBe('p1');
      expect(result.tiers.individual).toHaveLength(2);
      expect(result.tiers.individual[0].price).toBe(0.2);
      expect(result.tiers.factory).toHaveLength(0);
    });

    it('throws NotFound when the product is missing', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.getPriceHistory('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
