import { Logger } from '@nestjs/common';
import { OdooSyncProcessor } from './odoo-sync.processor';
import { ODOO_JOBS } from './odoo-sync.constants';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';

/**
 * Unit tests for OdooSyncProcessor — success path + compensation on final failure.
 */
describe('OdooSyncProcessor', () => {
  let processor: OdooSyncProcessor;
  let odoo: any;
  let notifications: any;
  let categoryRepo: any;
  let productRepo: any;
  let pricingRepo: any;
  let accountRepo: any;
  let warehouseRepo: any;
  let inventoryRepo: any;

  beforeEach(() => {
    // The compensation tests deliberately trigger failures; silence the logger.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    odoo = {
      createProductCategory: jest.fn(),
      updateProductCategory: jest.fn(),
      createRecycleWarehouse: jest.fn(),
    };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    categoryRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    productRepo = { findOne: jest.fn(), save: jest.fn(), delete: jest.fn() };
    pricingRepo = { createQueryBuilder: jest.fn() };
    accountRepo = { find: jest.fn().mockResolvedValue([{ id: 'admin1' }]) };
    warehouseRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    inventoryRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };

    processor = new OdooSyncProcessor(
      odoo,
      notifications,
      categoryRepo,
      productRepo,
      pricingRepo,
      accountRepo,
      warehouseRepo,
      inventoryRepo,
    );
  });

  it('creates the category in Odoo and marks it SYNCED on success', async () => {
    categoryRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Plastic' });
    odoo.createProductCategory.mockResolvedValue(42);

    const job: any = {
      name: ODOO_JOBS.SYNC_CATEGORY,
      data: { categoryId: 'c1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    await processor.process(job);

    const saved = categoryRepo.save.mock.calls[0][0];
    expect(saved.odooCategoryId).toBe(42);
    expect(saved.odooSyncStatus).toBe(OdooSyncStatus.SYNCED);
    expect(categoryRepo.delete).not.toHaveBeenCalled();
  });

  it('compensates (deletes local + notifies admins) when Odoo fails on the last attempt', async () => {
    categoryRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Plastic' }); // no odooCategoryId
    odoo.createProductCategory.mockRejectedValue(new Error('Odoo down'));

    const job: any = {
      name: ODOO_JOBS.SYNC_CATEGORY,
      data: { categoryId: 'c1' },
      attemptsMade: 2, // final attempt (attempts = 3)
      opts: { attempts: 3 },
    };

    await expect(processor.process(job)).rejects.toThrow('Odoo down');
    expect(categoryRepo.delete).toHaveBeenCalledWith('c1');
    expect(notifications.createNotification).toHaveBeenCalled();
    expect(notifications.enqueueNotification).toHaveBeenCalled();
  });

  it('does NOT compensate on a non-final failed attempt', async () => {
    categoryRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Plastic' });
    odoo.createProductCategory.mockRejectedValue(new Error('temporary'));

    const job: any = {
      name: ODOO_JOBS.SYNC_CATEGORY,
      data: { categoryId: 'c1' },
      attemptsMade: 0, // first attempt, will retry
      opts: { attempts: 3 },
    };

    await expect(processor.process(job)).rejects.toThrow('temporary');
    expect(categoryRepo.delete).not.toHaveBeenCalled();
  });

  it('creates the warehouse in Odoo and marks it SYNCED on success', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'Hub', code: 'H1', zones: [] });
    odoo.createRecycleWarehouse.mockResolvedValue(55);

    const job: any = {
      name: ODOO_JOBS.CREATE_WAREHOUSE,
      data: { warehouseId: 'w1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    await processor.process(job);

    const saved = warehouseRepo.save.mock.calls[0][0];
    expect(saved.odooWarehouseId).toBe(55);
    expect(saved.odooSyncStatus).toBe(OdooSyncStatus.SYNCED);
    expect(warehouseRepo.delete).not.toHaveBeenCalled();
  });

  it('compensates by deleting the backend warehouse when Odoo create fails on the last attempt', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'Hub', code: 'H1' }); // no odooWarehouseId
    odoo.createRecycleWarehouse.mockRejectedValue(new Error('Odoo down'));

    const job: any = {
      name: ODOO_JOBS.CREATE_WAREHOUSE,
      data: { warehouseId: 'w1' },
      attemptsMade: 2, // final attempt
      opts: { attempts: 3 },
    };

    await expect(processor.process(job)).rejects.toThrow('Odoo down');
    expect(warehouseRepo.delete).toHaveBeenCalledWith('w1');
    expect(notifications.createNotification).toHaveBeenCalled();
  });
});
