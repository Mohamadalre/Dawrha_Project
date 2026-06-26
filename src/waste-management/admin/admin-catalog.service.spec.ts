import { BadRequestException } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service';
import { UnitType } from '@src/waste-management/enums/unit-type.enum';

describe('AdminCatalogService', () => {
  let service: AdminCatalogService;
  let categoryRepo: any;
  let productRepo: any;
  let cartItemRepo: any;
  let odooSync: any;
  let audit: any;
  let cache: any;

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
    odooSync = {
      enqueueSyncCategory: jest.fn().mockResolvedValue(undefined),
      enqueueDeleteCategory: jest.fn().mockResolvedValue(undefined),
      enqueueSyncProduct: jest.fn().mockResolvedValue(undefined),
      enqueueDeleteProduct: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };

    service = new AdminCatalogService(categoryRepo, productRepo, cartItemRepo, odooSync, audit, cache);
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
      expect(cache.invalidate).toHaveBeenCalledWith('categories', 'products');
    });
  });

  describe('createProduct', () => {
    it('rejects an unknown category', async () => {
      categoryRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createProduct('a1', { name: 'X', category_id: 'c1', unit_type: UnitType.KG } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a pending product and enqueues sync', async () => {
      categoryRepo.findOne.mockResolvedValue({ id: 'c1' });
      const res = await service.createProduct('a1', {
        name: 'X',
        category_id: 'c1',
        unit_type: UnitType.KG,
      } as any);
      expect(odooSync.enqueueSyncProduct).toHaveBeenCalledWith({ productId: 'p1' });
      expect(cache.invalidate).toHaveBeenCalledWith('products', 'categories');
      expect(res.product_id).toBe('p1');
    });
  });

  describe('deleteProduct', () => {
    it('refuses when the product is in active carts', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'p1' });
      cartItemRepo.count.mockResolvedValue(2);
      await expect(service.deleteProduct('a1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
