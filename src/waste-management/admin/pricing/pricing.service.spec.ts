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
  let conditions: any;
  let productConditions: any;

  const dto = {
    individual: 0.3,
    company: 0.27,
    factory: [{ condition: 'EXCELLENT', price: 0.25 }],
    free_facility: [{ condition: 'EXCELLENT', price: 0.26 }],
  } as any;

  beforeEach(() => {
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1', isActive: true }) };
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
    conditions = {
      validateActiveCode: jest.fn(async (code: string) => String(code).toUpperCase()),
      // Grade NAMES are resolved per material — two materials may both have a
      // 'GOOD' and they are different grades of different things.
      labelMapFor: jest.fn(async () => new Map([['p1:GOOD', 'جيدة']])),
    };
    // The material decides the pricing shape now, so the spec has to say which
    // grades the material under test actually has.
    productConditions = {
      hasConditions: jest.fn().mockResolvedValue(true),
      activeCodes: jest.fn().mockResolvedValue(['EXCELLENT']),
      // A price is linked to its grade BY ID, so the code path resolves the
      // row rather than storing a bare string.
      findByCodeForProduct: jest.fn(async (_p: string, code: string) => ({
        id: `cond-${code.toLowerCase()}`,
        code,
      })),
      resolveForProduct: jest.fn(async (id: string) => ({
        id,
        code: 'EXCELLENT',
      })),
    };

    service = new PricingService(
      productRepo,
      pricingRepo,
      historyRepo,
      cartItemRepo,
      odooSync,
      audit,
      cache,
      conditions,
      productConditions,
      // A price change re-settles the offers on that material: the stored
      // percentage goes stale, and an amount that no longer fits would make
      // the price negative.
      { resettle: jest.fn().mockResolvedValue({ repriced: 0, suspended: 0 }) } as any,
    );
  });

  describe('setPricing', () => {
    it('throws NotFound when the product does not exist', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.setPricing('admin1', 'missing', dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('persists flat + per-condition rows and returns them', async () => {
      const result = await service.setPricing('admin1', 'p1', dto);

      // 2 flat rows (individual/company) + 1 factory condition + 1 free-facility condition
      expect(pricingRepo.save).toHaveBeenCalledTimes(4);
      expect(result.pricing).toEqual({
        individual: 0.3,
        company: 0.27,
        // The grade's ID travels back with the line. A price is FILED against
        // the grade, not merely labelled with its code — and this table is the
        // one the invoice is read from, so a line linked to the wrong grade is
        // money charged for something the buyer did not order.
        factory: [{ condition: 'EXCELLENT', conditionId: 'cond-excellent', price: 0.25 }],
        free_facility: [{ condition: 'EXCELLENT', conditionId: 'cond-excellent', price: 0.26 }],
      });
    });

    it('accepts the grade BY ID on the bulk price list', async () => {
      // The whole point of the id: a code is unique only inside its own
      // material, so "GOOD" is a different grade for paper than for copper.
      const res: any = await service.setPricing('admin-1', 'p1', {
        individual: 0.3,
        company: 0.27,
        factory: [{ condition_id: 'cond-excellent', price: 0.25 }],
        free_facility: [{ condition_id: 'cond-excellent', price: 0.26 }],
      } as any);

      expect(res.pricing.factory[0].conditionId).toBe('cond-excellent');
      expect(res.pricing.factory[0].condition).toBe('EXCELLENT');
    });

    it('refuses an id and a code that disagree', async () => {
      // Either could have been the intent. Quietly preferring one is how a
      // grade gets priced as another — and this table feeds the invoice.
      await expect(
        service.setPricing('admin-1', 'p1', {
          individual: 0.3,
          company: 0.27,
          factory: [{ condition_id: 'cond-excellent', condition: 'GOOD', price: 0.25 }],
          free_facility: [{ condition: 'EXCELLENT', price: 0.26 }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('links a code-only line to its grade rather than leaving it bare', async () => {
      // A price with no link is one the grade can be deleted out from under.
      const res: any = await service.setPricing('admin-1', 'p1', {
        individual: 0.3,
        company: 0.27,
        factory: [{ condition: 'EXCELLENT', price: 0.25 }],
        free_facility: [{ condition: 'EXCELLENT', price: 0.26 }],
      } as any);

      expect(res.pricing.factory[0].conditionId).toBe('cond-excellent');
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

    it('saves condition-tagged FACTORY / FREE_FACILITY rows', async () => {
      await service.setPricing('admin1', 'p1', dto);

      const savedTiers = pricingRepo.save.mock.calls.map((c: any[]) => c[0]);
      const freeFacility = savedTiers.find((r: any) => r.tier === PricingTier.FREE_FACILITY);
      const factory = savedTiers.find((r: any) => r.tier === PricingTier.FACTORY);

      expect(freeFacility.price).toBe('0.26');
      expect(freeFacility.conditionCode).toBe('EXCELLENT');
      expect(factory.price).toBe('0.25');
      expect(factory.conditionCode).toBe('EXCELLENT');
    });

    it('enqueues an Odoo sync job and writes an audit log', async () => {
      await service.setPricing('admin1', 'p1', dto);
      expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(cache.invalidate).toHaveBeenCalledWith('products', 'offers');
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
    it('updates ONE condition of a condition tier, archives it and reprices matching lines only', async () => {
      pricingRepo.find.mockImplementation((opts: any) =>
        opts?.where?.tier === PricingTier.FACTORY
          ? Promise.resolve([{ productId: 'p1', tier: PricingTier.FACTORY, conditionCode: 'EXCELLENT', price: '0.25', currency: 'JOD', effectiveFrom: new Date() }])
          : Promise.resolve([]),
      );
      cartItemRepo.find.mockResolvedValueOnce([
        { productId: 'p1', isOffer: false, quantity: '3', conditionCode: 'EXCELLENT', cart: { account: { role: Role.FACTORY } } },
        { productId: 'p1', isOffer: false, quantity: '2', conditionCode: 'GOOD', cart: { account: { role: Role.FACTORY } } },
        { productId: 'p1', isOffer: false, quantity: '1', cart: { account: { role: Role.CITIZEN } } },
      ]);

      const result = await service.updateTierPrice('admin1', 'p1', PricingTier.FACTORY, {
        price: 0.5,
        condition: 'EXCELLENT',
      } as any);

      expect(historyRepo.save).toHaveBeenCalled();
      expect(pricingRepo.save).toHaveBeenCalledTimes(1); // only one row inserted
      expect(result.tier).toBe('factory');
      expect(result.condition).toBe('EXCELLENT');
      expect(result.price).toBe(0.5);
      // only the FACTORY line with the matching condition is repriced
      expect(result.updated_cart_items).toBe(1);
    });

    it('requires a condition when editing a condition tier', async () => {
      await expect(
        service.updateTierPrice('admin1', 'p1', PricingTier.FACTORY, { price: 1 } as any),
      ).rejects.toMatchObject({ status: 400 });
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
        { tier: PricingTier.INDIVIDUAL, price: '0.30', conditionCode: null },
        { tier: PricingTier.FACTORY, price: '0.25', conditionCode: 'GOOD' },
      ]);

      const result: any = await service.getCurrentPricing('p1');

      expect(result.pricing.individual).toBe(0.3);
      expect(result.pricing.factory).toHaveLength(1);
      expect(result.pricing.factory[0]).toMatchObject({
        condition: 'GOOD',
        // Named as well as coded: a code alone identifies nothing to a reader,
        // because it is unique only within its material.
        condition_name: 'جيدة',
        price: 0.25,
      });
      expect(result.pricing.company).toBeNull();
      expect(result.pricing.free_facility).toEqual([]);
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
