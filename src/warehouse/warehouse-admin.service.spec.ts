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
let provinceRepo: any;
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

    // Grades are per material now, so the label map is asked for materials.
    conditionsService = { labelMapFor: jest.fn(async () => new Map()) } as any;
    const productRepo: any = { find: jest.fn().mockResolvedValue([]) };
    truckRepo = { createQueryBuilder: jest.fn(() => ({ select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) })) } as any;
    provinceRepo = { findOne: jest.fn().mockResolvedValue({ id: 'prov-1', name_ar: 'دمشق', name_en: 'Damascus' }) } as any;
    service = new WarehouseAdminService(warehouseRepo, managerRepo, inventoryRepo, truckRepo, odoo, odooSync, productRepo, conditionsService, provinceRepo);
  });

  describe('create', () => {
    const dto = {
      name: 'North Hub',
      code: 'NH1',
      latitude: 33.5,
      longitude: 36.3,
      zones: [{ name: 'Main', type: WarehouseZoneType.STORAGE }],
      // BOTH required now. A warehouse with no governorate holds stock that
      // order allocation can never route to; one with no address is a building
      // a driver cannot be sent to, and coordinates do not name a gate.
      provinceId: 'prov-1',
      address: 'دمشق — الطريق الشمالي',
    };

    /** A query builder that reports `count` matching rows for the code check. */
    const codeCountQb = (count: number) => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(count),
    });

    it('rejects a duplicate code', async () => {
      warehouseRepo.createQueryBuilder.mockReturnValue(codeCountQb(1));
      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(odooSync.enqueueCreateWarehouse).not.toHaveBeenCalled();
    });

    /**
     * "wh1" and "WH1" are the same warehouse to everyone who writes a code on
     * paperwork or reads one over the phone. The old check compared exactly, so
     * the second one sailed past and failed at the insert instead.
     */
    it('compares the code ignoring case and padding', async () => {
      const qb = codeCountQb(0);
      warehouseRepo.createQueryBuilder.mockReturnValue(qb);
      warehouseRepo.save.mockResolvedValue({ id: 'w1', code: 'NH1', zones: [] });

      await service.create({ ...dto, code: '  nh1  ' } as any);

      expect(String(qb.where.mock.calls[0][0])).toContain('upper(btrim(');
      // And stored trimmed — an invisible trailing space is the difference
      // nobody can see and everybody trips over.
      expect(warehouseRepo.create.mock.calls[0][0].code).toBe('nh1');
    });

    it('refuses a duplicate NAME, not only a duplicate code', async () => {
      // The name is what every human uses — it is on the paperwork, on the
      // shipment screen, in the order the driver is handed. Two warehouses
      // sharing one is a load delivered to the wrong building by somebody who
      // read the right name. Odoo has refused this all along; the backend
      // checked the code alone, so a name accepted here failed forever in the
      // sync queue.
      const qb = codeCountQb(0);
      // The code check passes, the name check finds one.
      qb.getCount = jest.fn()
        .mockResolvedValueOnce(0)   // code
        .mockResolvedValueOnce(1);  // name
      warehouseRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(odooSync.enqueueCreateWarehouse).not.toHaveBeenCalled();
    });

    it('refuses a governorate that does not exist', async () => {
      warehouseRepo.createQueryBuilder.mockReturnValue(codeCountQb(0));
      provinceRepo.findOne.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(warehouseRepo.save).not.toHaveBeenCalled();
    });

    it('writes the governorate NAME from the resolved row, never from free text', async () => {
      // A typed governorate is matched against a list it cannot be checked
      // against, so "دمشق" and "ريف دمشق" become two warehouses in places one
      // of which does not exist.
      warehouseRepo.createQueryBuilder.mockReturnValue(codeCountQb(0));
      warehouseRepo.save.mockResolvedValue({ id: 'w1', zones: [] });

      await service.create(dto);

      const written = warehouseRepo.create.mock.calls[0][0];
      expect(written.provinceId).toBe('prov-1');
      expect(written.governorate).toBe('دمشق');
    });

    it('saves locally (PENDING) and queues the Odoo create job', async () => {
      warehouseRepo.createQueryBuilder.mockReturnValue(codeCountQb(0));
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

  // Stock reads moved to InventoryQueryService — covered by its own spec.

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
