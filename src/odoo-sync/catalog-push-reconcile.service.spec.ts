import { CatalogPushReconcileService } from './catalog-push-reconcile.service';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';

/**
 * The plainest split brain of all: an admin creates a catalogue row, Odoo is
 * down, the job gives up, and the row is stamped FAILED — a status nothing in
 * the codebase ever read back.
 */
describe('CatalogPushReconcileService', () => {
  let service: CatalogPushReconcileService;
  let odooSync: any;
  let odoo: any;
  const repos: Record<string, any> = {};

  const empty = () => ({ find: jest.fn().mockResolvedValue([]) });

  beforeEach(() => {
    jest.spyOn(winstonLogger, 'warn').mockImplementation(() => undefined as any);

    for (const k of ['category', 'product', 'unit', 'condition', 'warehouse']) {
      repos[k] = empty();
    }
    odooSync = {
      enqueueSyncCategory: jest.fn().mockResolvedValue(undefined),
      enqueueSyncProduct: jest.fn().mockResolvedValue(undefined),
      enqueueUpdatePricing: jest.fn().mockResolvedValue(undefined),
      enqueueSyncUnit: jest.fn().mockResolvedValue(undefined),
      enqueueSyncCondition: jest.fn().mockResolvedValue(undefined),
      enqueueCreateWarehouse: jest.fn().mockResolvedValue(undefined),
    };
    odoo = {
      // Default: Odoo holds nothing — every SYNCED id counts as dangling.
      fetchCatalogueIds: jest
        .fn()
        .mockResolvedValue({ categories: [], products: [], units: [], conditions: [] }),
    };
    service = new CatalogPushReconcileService(
      repos.category,
      repos.product,
      repos.unit,
      repos.condition,
      repos.warehouse,
      odooSync,
      odoo,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('re-pushes a category whose push was given up on', async () => {
    repos.category.find.mockResolvedValue([{ id: 'cat-1' }]);

    const counts = await service.reconcile('manual');

    expect(counts.categories).toBe(1);
    expect(odooSync.enqueueSyncCategory).toHaveBeenCalledWith({ categoryId: 'cat-1' });
  });

  it('re-pushes a product together with its prices', async () => {
    // Odoo's invoices read those prices; a product without them is priceless
    // there in the literal sense.
    repos.product.find.mockResolvedValue([{ id: 'prod-1' }]);

    await service.reconcile('manual');

    expect(odooSync.enqueueSyncProduct).toHaveBeenCalledWith({ productId: 'prod-1' });
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'prod-1' });
  });

  it('covers units, conditions and warehouses too', async () => {
    repos.unit.find.mockResolvedValue([{ id: 'u-1' }]);
    repos.condition.find.mockResolvedValue([{ id: 'c-1' }]);
    repos.warehouse.find.mockResolvedValue([{ id: 'w-1' }]);

    const counts = await service.reconcile('manual');

    expect(odooSync.enqueueSyncUnit).toHaveBeenCalledWith({ unitId: 'u-1' });
    expect(odooSync.enqueueSyncCondition).toHaveBeenCalledWith({ conditionId: 'c-1' });
    expect(odooSync.enqueueCreateWarehouse).toHaveBeenCalledWith({ warehouseId: 'w-1' });
    expect(counts).toMatchObject({ units: 1, conditions: 1, warehouses: 1 });
  });

  it('looks for anything NOT SYNCED, not just FAILED', async () => {
    // A PENDING row past the grace period is a job that vanished — a worker
    // killed mid-flight never reports a failure at all, so keying only off
    // FAILED would leave it stranded silently.
    await service.reconcile('manual');

    const where = repos.category.find.mock.calls[0][0].where;
    expect(where.odooSyncStatus._value).toBe(OdooSyncStatus.SYNCED);
    expect(where.odooSyncStatus._type).toBe('not');
    expect(where.createdAt).toBeDefined(); // grace period applied
  });

  it('does nothing when everything is synced', async () => {
    const counts = await service.reconcile('manual');

    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(odooSync.enqueueSyncCategory).not.toHaveBeenCalled();
  });

  it('survives a repository error without killing the loop', async () => {
    repos.category.find.mockRejectedValue(new Error('db down'));

    await expect(service.reconcile('cron')).resolves.toBeDefined();
  });

  /**
   * The dangling repair: rows stamped SYNCED whose stored Odoo id no longer
   * exists there (an Odoo wipe). Nothing else ever re-pushed them, so Odoo
   * stayed empty forever while both sides claimed to be healthy.
   */
  describe('repairDangling', () => {
    it('re-pushes a SYNCED category whose Odoo record vanished', async () => {
      repos.category.find.mockResolvedValue([
        { id: 'cat-9', odooCategoryId: 44, odooSyncStatus: OdooSyncStatus.SYNCED },
      ]);

      const counts = await service.repairDangling('manual');

      expect(odoo.fetchCatalogueIds).toHaveBeenCalled();
      expect(odooSync.enqueueSyncCategory).toHaveBeenCalledWith({ categoryId: 'cat-9' });
      expect(counts.categories).toBe(1);
    });

    it('re-pushes a SYNCED product (pricing travels with it via the handler)', async () => {
      repos.product.find.mockResolvedValue([
        { id: 'prod-9', odooProductId: 33, odooSyncStatus: OdooSyncStatus.SYNCED },
      ]);

      const counts = await service.repairDangling('manual');

      expect(odooSync.enqueueSyncProduct).toHaveBeenCalledWith({ productId: 'prod-9' });
      expect(counts.products).toBe(1);
    });

    it('leaves rows that are not SYNCED alone — the push reconcile owns those', async () => {
      repos.unit.find.mockResolvedValue([
        { id: 'u-failed', odooUnitId: 5, odooSyncStatus: OdooSyncStatus.FAILED },
        { id: 'u-ok', odooUnitId: 6, odooSyncStatus: OdooSyncStatus.SYNCED },
      ]);

      await service.repairDangling('manual');

      // FAILED is re-pushed by reconcile(); only the dangling SYNCED row here.
      expect(odooSync.enqueueSyncUnit).toHaveBeenCalledTimes(1);
      expect(odooSync.enqueueSyncUnit).toHaveBeenCalledWith({ unitId: 'u-ok' });
    });

    it('keeps quiet when every SYNCED id still exists in Odoo', async () => {
      repos.condition.find.mockResolvedValue([
        { id: 'c-ok', odooConditionId: 21, odooSyncStatus: OdooSyncStatus.SYNCED },
      ]);
      odoo.fetchCatalogueIds.mockResolvedValue({
        categories: [], products: [], units: [], conditions: [21],
      });

      const counts = await service.repairDangling('manual');

      expect(odooSync.enqueueSyncCondition).not.toHaveBeenCalled();
      expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    });

    it('survives an unreachable Odoo without throwing', async () => {
      odoo.fetchCatalogueIds.mockRejectedValue(new Error('Odoo down'));

      await expect(service.repairDangling('cron')).resolves.toBeDefined();
    });
  });
});

// watch-restart trigger (no-op)
