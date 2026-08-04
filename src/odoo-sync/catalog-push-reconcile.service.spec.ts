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
    service = new CatalogPushReconcileService(
      repos.category,
      repos.product,
      repos.unit,
      repos.condition,
      repos.warehouse,
      odooSync,
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
});
