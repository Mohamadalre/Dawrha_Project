import { Logger } from '@nestjs/common';
import { OdooSyncProcessor } from './odoo-sync.processor';
import { ODOO_JOBS } from './odoo-sync.constants';
import { OrderPartStatus } from '@src/order/enums/order-part-status.enum';
import { FulfilmentMode } from '@src/order/enums/fulfilment-mode.enum';
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
  let warehouseManagerRepo: any;
  let unitRepo: any;
  let conditionRepo: any;
  let truckRepo: any;
  let assignmentRepo: any;
  let shiftRepo: any;
  let collectorRepo: any;
  let shiftChangeRepo: any;
  let mediaRepo: any;
  let offerRepo: any;
  let orderRepo: any;
  let orderPartRepo: any;
  let orderPartOfferRepo: any;
  let distanceCacheRepo: any;
  let rates: any;

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
    inventoryRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve(x)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    warehouseManagerRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve(x)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    unitRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    conditionRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const mkRepo = () => ({
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve(x)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    });
    const provinceRepo: any = mkRepo();
    const tariffRepo: any = mkRepo();
    orderRepo = mkRepo();
    orderPartRepo = mkRepo();
    orderPartOfferRepo = mkRepo();
    distanceCacheRepo = mkRepo();
    truckRepo = mkRepo();
    assignmentRepo = mkRepo();
    shiftRepo = mkRepo();
    collectorRepo = mkRepo();
    shiftChangeRepo = mkRepo();
    const truckProblemRepo: any = mkRepo();
    const handoverRepo: any = mkRepo();
    const userDeviceRepo: any = { ...mkRepo(), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    mediaRepo = { ...mkRepo(), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    offerRepo = mkRepo();
    rates = {
      quote: jest.fn().mockResolvedValue({ cost: 0, currency: 'JOD' }),
    };

    processor = new OdooSyncProcessor(
      odoo,
      notifications,
      { add: jest.fn().mockResolvedValue(undefined) } as any, // orderTasks queue
      categoryRepo,
      productRepo,
      pricingRepo,
      offerRepo,
      accountRepo,
      warehouseRepo,
      inventoryRepo,
      warehouseManagerRepo,
      unitRepo,
      conditionRepo,
      provinceRepo,
      tariffRepo,
      orderRepo,
      orderPartRepo,
      orderPartOfferRepo,
      distanceCacheRepo,
      truckRepo,
      assignmentRepo,
      shiftRepo,
      collectorRepo,
      shiftChangeRepo,
      truckProblemRepo,
      handoverRepo,
      userDeviceRepo,
      mediaRepo,
      rates,
      { invalidate: jest.fn().mockResolvedValue(undefined) } as any, // catalog cache
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

  /**
   * The warehouse sync mirrors the MANAGER.
   *
   * `GET /admin/warehouses` reported `manager: null` for warehouses that
   * plainly had one in Odoo. The read APIs join the relation correctly — there
   * was simply nothing in `warehouse_managers` to join to, because only two
   * manual admin routes ever wrote a row. The manager therefore appeared after
   * somebody pressed sync by hand, and never on its own.
   */
  describe('SYNC_WAREHOUSE mirrors the manager Odoo assigned', () => {
    const syncJob: any = {
      name: ODOO_JOBS.SYNC_WAREHOUSE,
      data: { warehouseId: 'w1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    beforeEach(() => {
      warehouseRepo.findOne.mockResolvedValue({
        id: 'w1',
        name: 'Hub',
        code: 'H1',
        odooWarehouseId: 55,
      });
      // The rest of the sync is not under test here.
      odoo.fetchWarehouseInfo = jest.fn().mockResolvedValue(null);
      odoo.fetchWarehouseInventory = jest.fn().mockResolvedValue([]);
    });

    it('writes the manager, keyed by the Odoo user id', async () => {
      odoo.fetchWarehouseManager = jest.fn().mockResolvedValue({
        id: 99,
        name: 'Sara',
        login: 'sara@example.com',
        email: 'sara@example.com',
        phone: '0100',
      });

      await processor.process(syncJob);

      const saved = warehouseManagerRepo.save.mock.calls[0][0];
      expect(saved.odooUserId).toBe(99);
      expect(saved.fullName).toBe('Sara');
      expect(saved.email).toBe('sara@example.com');
      expect(saved.warehouse.id).toBe('w1');
    });

    it('falls back to the Odoo login when the user has no email set', async () => {
      odoo.fetchWarehouseManager = jest.fn().mockResolvedValue({
        id: 99,
        name: 'Sara',
        login: 'sara@example.com',
        email: false,
        phone: '',
      });

      await processor.process(syncJob);

      expect(warehouseManagerRepo.save.mock.calls[0][0].email).toBe(
        'sara@example.com',
      );
    });

    it('drops the mirrored manager when Odoo no longer has one', async () => {
      // A stale row is the worse of the two failures: the API would keep
      // naming someone who is no longer responsible for the site.
      const stale = { id: 'm1', odooUserId: 7, warehouse: { id: 'w1' } };
      warehouseManagerRepo.findOne.mockResolvedValue(stale);
      odoo.fetchWarehouseManager = jest.fn().mockResolvedValue(null);

      await processor.process(syncJob);

      expect(warehouseManagerRepo.remove).toHaveBeenCalledWith(stale);
      expect(warehouseManagerRepo.save).not.toHaveBeenCalled();
    });

    it('removes the previous holder when the job passes to someone else', async () => {
      const previous = { id: 'm1', odooUserId: 7, warehouse: { id: 'w1' } };
      warehouseManagerRepo.findOne
        .mockResolvedValueOnce(previous)   // current holder for this warehouse
        .mockResolvedValueOnce(null);      // no row yet for the new Odoo user
      odoo.fetchWarehouseManager = jest.fn().mockResolvedValue({
        id: 99, name: 'Sara', login: 'sara@example.com', email: '', phone: '',
      });

      await processor.process(syncJob);

      expect(warehouseManagerRepo.save).toHaveBeenCalled();
      expect(warehouseManagerRepo.remove).toHaveBeenCalledWith(previous);
    });

    it('still syncs the stock when the manager lookup fails', async () => {
      // Losing a whole inventory refresh because one lookup timed out would
      // trade a small staleness for a large one.
      odoo.fetchWarehouseManager = jest
        .fn()
        .mockRejectedValue(new Error('Odoo timed out'));

      await expect(processor.process(syncJob)).resolves.not.toThrow();
      expect(odoo.fetchWarehouseInventory).toHaveBeenCalledWith(55);
    });
  });

  describe('APPLY_ORDER_EVENT — admin reassigned a split part', () => {
    const reassignJob = (warehouseOdooId = 77): any => ({
      name: ODOO_JOBS.APPLY_ORDER_EVENT,
      data: {
        partId: 'part-1',
        odooOrderId: 500,
        event: 'reassigned',
        warehouseOdooId,
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    const offeredPart = () => ({
      id: 'part-1',
      orderId: 'ord-1',
      warehouseId: 'wh-old',
      status: OrderPartStatus.OFFERED,
      distanceKm: '10',
      deliveryCost: '5',
      order: {
        id: 'ord-1',
        orderNumber: 'ORD-1',
        buyerProfileId: 'buyer-1',
        provinceId: 'prov-1',
        fulfilmentMode: FulfilmentMode.DELIVERY,
        goodsTotal: '100',
      },
    });

    beforeEach(() => {
      orderPartRepo.findOne.mockResolvedValue(offeredPart());
      warehouseRepo.findOne.mockResolvedValue({ id: 'wh-new', odooWarehouseId: 77 });
      distanceCacheRepo.findOne.mockResolvedValue({ distanceKm: '42' });
      orderRepo.findOne.mockResolvedValue({
        id: 'ord-1', orderNumber: 'ORD-1', goodsTotal: '100',
      });
      orderPartRepo.find.mockResolvedValue([
        { status: OrderPartStatus.OFFERED, deliveryCost: '8' },
      ]);
      rates.quote.mockResolvedValue({ cost: 8, currency: 'JOD' });
    });

    it('re-points the part, re-prices the leg from the new distance, and refreshes totals', async () => {
      await processor.process(reassignJob());

      const savedPart = orderPartRepo.save.mock.calls[0][0];
      expect(savedPart.warehouseId).toBe('wh-new');
      expect(savedPart.distanceKm).toBe('42');
      expect(rates.quote).toHaveBeenCalledWith(42);
      expect(savedPart.deliveryCost).toBe('8');

      const savedOrder = orderRepo.save.mock.calls[0][0];
      expect(savedOrder.deliveryTotal).toBe('8');
      expect(savedOrder.grandTotal).toBe('108');
    });

    it('ignores a reassignment of a part that has already moved on', async () => {
      orderPartRepo.findOne.mockResolvedValue({
        ...offeredPart(),
        status: OrderPartStatus.PROCESSING,
      });

      await processor.process(reassignJob());

      expect(orderPartRepo.save).not.toHaveBeenCalled();
      expect(rates.quote).not.toHaveBeenCalled();
    });

    it('does nothing when the new Odoo warehouse has no mirror here', async () => {
      warehouseRepo.findOne.mockResolvedValue(null);

      await processor.process(reassignJob(999));

      expect(orderPartRepo.save).not.toHaveBeenCalled();
    });
  });
});
