import { Logger, NotFoundException } from '@nestjs/common';
import { WarehouseAdminService } from './warehouse-admin.service';

describe('WarehouseAdminService', () => {
  let service: WarehouseAdminService;
  let warehouseRepo: any;
  let managerRepo: any;
  let inventoryRepo: any;
  let odoo: any;
  let odooSync: any;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    warehouseRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'w1', odooWarehouseId: 1, ...x })),
      createQueryBuilder: jest.fn(),
    };
    managerRepo = { findOne: jest.fn(), create: jest.fn((x) => x), save: jest.fn((x) => x) };
    inventoryRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    odoo = { fetchWarehouses: jest.fn(), fetchWarehouseManager: jest.fn() };
    odooSync = { enqueueSyncWarehouse: jest.fn().mockResolvedValue(undefined) };

    service = new WarehouseAdminService(warehouseRepo, managerRepo, inventoryRepo, odoo, odooSync);
  });

  describe('sync', () => {
    it('throws NotFound for an unknown warehouse', async () => {
      warehouseRepo.findOne.mockResolvedValue(null);
      await expect(service.sync('w1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('queues an Odoo sync job', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', odooWarehouseId: 1 });
      const res = await service.sync('w1', false);
      expect(odooSync.enqueueSyncWarehouse).toHaveBeenCalled();
      expect(res.status).toBe('QUEUED');
      expect(res.sync_job_id).toBeDefined();
    });
  });

  describe('inventory', () => {
    it('throws NotFound for an unknown warehouse', async () => {
      warehouseRepo.findOne.mockResolvedValue(null);
      await expect(service.inventory('w1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns inventory rows + summary', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH', lastOdooSync: null });
      inventoryRepo.find.mockResolvedValue([
        { odooProductId: 10, productName: 'P', quantity: '5', reservedQuantity: '0', reorderLevel: 2, syncedAt: null },
      ]);
      const res = await service.inventory('w1');
      expect(res.warehouse_id).toBe('w1');
      expect(res.inventory).toHaveLength(1);
      expect(res.summary.total_items_count).toBe(1);
    });
  });

  describe('importFromOdoo', () => {
    it('imports new warehouses from Odoo', async () => {
      odoo.fetchWarehouses.mockResolvedValue([{ id: 1, name: 'W', code: 'WH1', manager_user_id: false }]);
      warehouseRepo.findOne.mockResolvedValue(null); // new
      odoo.fetchWarehouseManager.mockResolvedValue(null); // no manager

      const res = await service.importFromOdoo();

      expect(warehouseRepo.save).toHaveBeenCalled();
      expect(res.imported).toBe(1);
      expect(res.created).toBe(1);
      expect(res.updated).toBe(0);
    });
  });
});
