import { BadRequestException } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service';


describe('AdminCatalogService', () => {
  let service: AdminCatalogService;
  let categoryRepo: any;
  let productRepo: any;
  let inventoryRepo: any;
  let cartItemRepo: any;
  let odooSync: any;
  let audit: any;
  let cache: any;
  let unitRepo: any;
  let units: any;
  let conditionRepo: any;
  let pricingRepo: any;
  let offerRepo: any;
  let conditionsService: any;

  beforeEach(() => {
    categoryRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'c1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    productRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'p1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
    };
    cartItemRepo = { count: jest.fn().mockResolvedValue(0) };
    // Deleting a material has to know whether any is still on a shelf.
    inventoryRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      })),
    };
    odooSync = {
      enqueueSyncCategory: jest.fn().mockResolvedValue(undefined),
      enqueueDeleteCategory: jest.fn().mockResolvedValue(undefined),
      enqueueSyncProduct: jest.fn().mockResolvedValue(undefined),
      enqueueDeleteProduct: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    unitRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'unit1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const KG = { id: 'u-kg', code: 'KG', nameEn: 'Kilogram', nameAr: 'كيلوغرام' };
    units = {
      validateActiveCode: jest.fn(async (code: string) => String(code).toUpperCase()),
      resolveActiveByCode: jest.fn(async (code: string) => ({
        ...KG,
        code: String(code).toUpperCase(),
      })),
      resolveActiveById: jest.fn(async (id: string) => ({ ...KG, id })),
      invalidate: jest.fn(),
    };

    conditionRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'cond1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    pricingRepo = { count: jest.fn().mockResolvedValue(0) };
    offerRepo = { findOne: jest.fn(), create: jest.fn((x) => x), save: jest.fn((x) => Promise.resolve({ id: 'o1', ...x })), delete: jest.fn() };
    conditionsService = { invalidate: jest.fn() };

    service = new AdminCatalogService(
      categoryRepo,
      productRepo,
      inventoryRepo,
      cartItemRepo,
      unitRepo,
      conditionRepo,
      pricingRepo,
      offerRepo,
      odooSync,
      audit,
      cache,
      units,
      conditionsService,
      // Offer creation writes several rows in one transaction; nothing in this
      // suite creates one, so a stub that simply runs the callback is enough.
      { transaction: jest.fn(async (cb: any) => cb({ getRepository: () => offerRepo })) } as any,
    );
  });

  describe('createCategory', () => {
    it('rejects a duplicate name', async () => {
      categoryRepo.findOne.mockResolvedValue({ id: 'x' });
      await expect(service.createCategory('a1', { name: 'Plastic' } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates, enqueues Odoo sync, audits and invalidates cache', async () => {
      categoryRepo.findOne.mockResolvedValue(null);
      const res = await service.createCategory('a1', { name: 'Plastic' } as any);

      expect(odooSync.enqueueSyncCategory).toHaveBeenCalledWith({ categoryId: 'c1' });
      expect(audit.record).toHaveBeenCalled();
      expect(cache.invalidate).toHaveBeenCalledWith('categories');
      expect(res.category_id).toBe('c1');
    });
  });

  describe('deleteCategory', () => {
    it('refuses when the category still has products', async () => {
      categoryRepo.findOne.mockResolvedValue({ id: 'c1' });
      productRepo.count.mockResolvedValue(3);
      await expect(service.deleteCategory('a1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes and invalidates caches', async () => {
      categoryRepo.findOne.mockResolvedValue({ id: 'c1', odooCategoryId: 7 });
      productRepo.count.mockResolvedValue(0);
      await service.deleteCategory('a1', 'c1');
      expect(odooSync.enqueueDeleteCategory).toHaveBeenCalledWith({ odooCategoryId: 7 });
      expect(categoryRepo.delete).toHaveBeenCalledWith('c1');
      expect(cache.invalidate).toHaveBeenCalledWith('categories', 'products', 'offers');
    });
  });

  describe('createProduct', () => {
    it('rejects an unknown category with 404', async () => {
      categoryRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createProduct('a1', { name: 'X', category_id: 'c1', unit_id: 'u-kg' } as any),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('creates a pending product and enqueues sync', async () => {
      categoryRepo.findOne.mockResolvedValue({ id: 'c1' });
      const res = await service.createProduct('a1', {
        name: 'X',
        category_id: 'c1',
        unit_id: 'u-kg',
      } as any);
      expect(odooSync.enqueueSyncProduct).toHaveBeenCalledWith({ productId: 'p1' });
      expect(cache.invalidate).toHaveBeenCalledWith('products', 'categories', 'offers');
      expect(res.product_id).toBe('p1');
    });

    /**
     * A material is linked to its unit by id, the way it is to its category.
     *
     * Both columns are written together on purpose. `unitId` is the link;
     * `unitType` is the code Odoo, the cart and the suggestion flow read. If
     * the two were allowed to drift, a material would be measured in one unit
     * and priced in another.
     */
    it('links the unit by id and writes the code alongside it', async () => {
      categoryRepo.findOne.mockResolvedValue({ id: 'c1' });
      await service.createProduct('a1', {
        name: 'X',
        category_id: 'c1',
        unit_id: 'u-kg',
      } as any);

      const saved = productRepo.create.mock.calls[0][0];
      expect(saved.unitId).toBe('u-kg');
      expect(saved.unitType).toBe('KG');
    });

    it('ignores a unit CODE — the unit is named by id alone', async () => {
      // The code stopped being an input: it is a label that can be renamed and
      // re-used, so two callers sending "KG" could mean two different rows.
      // What is stored is whatever the ID resolves to, never what was typed.
      categoryRepo.findOne.mockResolvedValue({ id: 'c1' });
      await service.createProduct('a1', {
        name: 'X',
        category_id: 'c1',
        unit_id: 'u-kg',
        unit_type: 'PIECE',
      } as any);

      expect(productRepo.create.mock.calls[0][0].unitType).toBe('KG');
    });

    it('refuses a material with no unit at all', async () => {
      categoryRepo.findOne.mockResolvedValue({ id: 'c1' });
      await expect(
        service.createProduct('a1', { name: 'X', category_id: 'c1' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('deleteProduct', () => {
    /**
     * A material still on a warehouse floor cannot be deleted.
     *
     * The stock rows mirror Odoo, which is the only writer of quantities.
     * Deleting the material would leave real, physical stock described by a
     * catalogue entry that no longer exists: the warehouse can see it, the
     * system cannot name it, and no order can ever be raised to clear it.
     */
    it('refuses while any quantity is still held in a warehouse', async () => {
      productRepo.findOne.mockResolvedValue({
        id: 'p1', name: 'PET Bottles', odooProductId: 10,
      });
      cartItemRepo.count.mockResolvedValue(0);
      inventoryRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '42.5' }),
      });

      await expect(service.deleteProduct('a1', 'p1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(productRepo.delete).not.toHaveBeenCalled();
      // And nothing is asked of Odoo either — a delete that was refused here
      // must not leave the mirror half-removed.
      expect(odooSync.enqueueDeleteProduct).not.toHaveBeenCalled();
    });

    it('deletes once the stock has reached zero', async () => {
      productRepo.findOne.mockResolvedValue({
        id: 'p1', name: 'PET Bottles', odooProductId: 10,
      });
      cartItemRepo.count.mockResolvedValue(0);
      inventoryRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      });

      await service.deleteProduct('a1', 'p1');

      expect(productRepo.delete).toHaveBeenCalledWith('p1');
    });

    it('refuses when the product is in active carts', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1' });
      cartItemRepo.count.mockResolvedValue(2);
      await expect(service.deleteProduct('a1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
