import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WarehouseAdminService } from './warehouse-admin.service';
import { WarehouseZoneType } from './enums/warehouse-zone-type.enum';

let conditionsService: any;
let truckRepo: any;
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
    odooSync = {
      enqueueSyncWarehouse: jest.fn().mockResolvedValue(undefined),
      enqueueCreateWarehouse: jest.fn().mockResolvedValue(undefined),
    };

    conditionsService = { labelMap: jest.fn(async () => new Map()) } as any;
    truckRepo = { createQueryBuilder: jest.fn(() => ({ select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) })) } as any;
    service = new WarehouseAdminService(warehouseRepo, managerRepo, inventoryRepo, truckRepo, odoo, odooSync, conditionsService);
  });

  describe('create', () => {
    const dto = {
      name: 'North Hub',
      code: 'NH1',
      latitude: 33.5,
      longitude: 36.3,
      zones: [{ name: 'Main', type: WarehouseZoneType.STORAGE }],
    };

    it('rejects a duplicate code', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w0', code: 'NH1' });
      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(odooSync.enqueueCreateWarehouse).not.toHaveBeenCalled();
    });

    it('saves locally (PENDING) and queues the Odoo create job', async () => {
      warehouseRepo.findOne.mockResolvedValue(null);
      warehouseRepo.save.mockResolvedValue({ id: 'w1', name: 'North Hub', code: 'NH1', odooSyncStatus: 'PENDING', zones: dto.zones });

      const res = await service.create(dto);

      expect(warehouseRepo.save).toHaveBeenCalled();
      expect(odooSync.enqueueCreateWarehouse).toHaveBeenCalledWith({ warehouseId: 'w1' });
      expect(res.status).toBe('QUEUED');
      expect(res.odoo_sync_status).toBe('PENDING');
    });
  });

  describe('syncManagerFromOdoo', () => {
    it('throws NotFound for an unknown warehouse', async () => {
      warehouseRepo.findOne.mockResolvedValue(null);
      await expect(service.syncManagerFromOdoo('w1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when the warehouse is not yet in Odoo', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', odooWarehouseId: null });
      await expect(service.syncManagerFromOdoo('w1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('mirrors the Odoo-assigned manager into the backend', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', odooWarehouseId: 7 });
      odoo.fetchWarehouseManager.mockResolvedValue({ id: 99, name: 'Sara', login: 'sara@x.com', email: 'sara@x.com', phone: '123' });
      // first findOne (in syncManager) → not existing; final findOne → the saved manager
      managerRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'm1', fullName: 'Sara', email: 'sara@x.com', phone: '123' });

      const res = await service.syncManagerFromOdoo('w1');

      expect(managerRepo.save).toHaveBeenCalled();
      expect(res.manager?.name).toBe('Sara');
      expect(res.message).toContain('synced');
    });
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
