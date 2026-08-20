import { NotFoundException } from '@nestjs/common';
import { InventoryQueryService } from './inventory-query.service';
import { StockStatus } from '@src/waste-management/enums/stock-status.enum';

/**
 * The one thing these tests exist to protect: `available` is
 * `quantity - reserved`, everywhere, at every level of the response. Reserved
 * stock is already promised to an order that has not left the building; a read
 * route that reported it as sellable is how the same crate is sold twice.
 */
describe('InventoryQueryService', () => {
  let service: InventoryQueryService;
  let inventoryRepo: any;
  let warehouseRepo: any;
  let productRepo: any;
  let conditionRepo: any;
  let conditions: any;
  let units: any;

  const KG = { id: 'u-kg', code: 'KG', nameEn: 'Kilogram', nameAr: 'كيلوغرام' };
  const PIECE = { id: 'u-pc', code: 'PIECE', nameEn: 'Piece', nameAr: 'قطعة' };

  const PRODUCT = {
    id: 'p-1',
    name: 'PET Bottles',
    unitId: KG.id,
    unitType: 'KG',
    odooProductId: 10,
  };
  const BATTERIES = {
    id: 'p-2',
    name: 'Car Batteries',
    unitId: PIECE.id,
    unitType: 'PIECE',
    odooProductId: 11,
  };

  /** A grouped-summary query builder returning whatever rows the test supplies. */
  const summaryBuilder = (rows: any[]) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  });

  beforeEach(() => {
    inventoryRepo = { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn() };
    warehouseRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    productRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    conditionRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'c-good', productId: 'p-1', code: 'GOOD' },
      ]),
    };
    conditions = {
      labelMapFor: jest.fn(async () => new Map([['p-1:GOOD', 'جيدة']])),
    };
    units = {
      byId: jest.fn(async () => new Map([[KG.id, KG], [PIECE.id, PIECE]])),
      byCode: jest.fn(async () => new Map([['KG', KG], ['PIECE', PIECE]])),
    };
    service = new InventoryQueryService(
      inventoryRepo,
      warehouseRepo,
      productRepo,
      conditionRepo,
      conditions,
      units,
    );
  });

  describe('forProductInWarehouse', () => {
    it('throws when the material does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1' });
      await expect(
        service.forProductInWarehouse('p-x', 'w1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the warehouse does not exist', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      warehouseRepo.findOne.mockResolvedValue(null);
      await expect(
        service.forProductInWarehouse('p-1', 'w-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('subtracts reserved stock from available, per grade and in total', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      productRepo.find.mockResolvedValue([PRODUCT]);
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH', code: 'W1' });
      inventoryRepo.find.mockResolvedValue([
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'GOOD', quantity: '100', reservedQuantity: '30', reorderLevel: 5 },
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'UNGRADED', quantity: '50', reservedQuantity: '0', reorderLevel: 5 },
      ]);

      const res = await service.forProductInWarehouse('p-1', 'w1');

      expect(res.quantity).toBe(150);
      expect(res.reserved_quantity).toBe(30);
      expect(res.available).toBe(120);
      const good = res.conditions.find((c) => c.condition?.code === 'GOOD')!;
      expect(good.available).toBe(70);
    });

    it('never reports negative availability when Odoo over-reserves', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      productRepo.find.mockResolvedValue([PRODUCT]);
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH' });
      inventoryRepo.find.mockResolvedValue([
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'GOOD', quantity: '5', reservedQuantity: '9', reorderLevel: 0 },
      ]);

      const res = await service.forProductInWarehouse('p-1', 'w1');
      expect(res.available).toBe(0);
    });

    it('reports an unsynced material as unsynced, not as sold out', async () => {
      productRepo.findOne.mockResolvedValue({ ...PRODUCT, odooProductId: undefined });
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH' });

      const res = await service.forProductInWarehouse('p-1', 'w1');

      expect(res.product.synced_with_odoo).toBe(false);
      expect(res.quantity).toBe(0);
      expect(inventoryRepo.find).not.toHaveBeenCalled();
    });

    it('returns zeros for a material this warehouse simply does not hold', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH' });
      inventoryRepo.find.mockResolvedValue([]);

      const res = await service.forProductInWarehouse('p-1', 'w1');

      expect(res.available).toBe(0);
      expect(res.conditions).toEqual([]);
      expect(res.stock_status).toBe(StockStatus.OUT_OF_STOCK);
    });
  });

  describe('forProduct', () => {
    it('totals one material across warehouses and says where it is', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      productRepo.find.mockResolvedValue([PRODUCT]);
      warehouseRepo.find.mockResolvedValue([
        { id: 'w1', name: 'North', code: 'N1', governorate: 'Damascus' },
        { id: 'w2', name: 'South', code: 'S1', governorate: 'Daraa' },
      ]);
      inventoryRepo.find.mockResolvedValue([
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'GOOD', quantity: '40', reservedQuantity: '10', reorderLevel: 0 },
        { warehouseId: 'w2', odooProductId: 10, conditionCode: 'GOOD', quantity: '60', reservedQuantity: '0', reorderLevel: 0 },
      ]);

      const res = await service.forProduct('p-1');

      expect(res.total_quantity).toBe(100);
      expect(res.total_available).toBe(90);
      expect(res.warehouse_count).toBe(2);
      // Sorted by what can actually be sold, so the allocator's first choice
      // is the first row an admin reads.
      expect(res.warehouses[0].warehouse_name).toBe('South');
      expect(res.warehouses[0].available).toBe(60);
      expect(res.warehouses[1].available).toBe(30);
    });

    it('throws for an unknown material', async () => {
      productRepo.findOne.mockResolvedValue(null);
      await expect(service.forProduct('p-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listForWarehouse', () => {
    it('throws for an unknown warehouse', async () => {
      warehouseRepo.findOne.mockResolvedValue(null);
      await expect(service.listForWarehouse('w-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('pages over materials and summarises the whole warehouse, not the page', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH', code: 'W1' });
      productRepo.find.mockResolvedValue([PRODUCT, BATTERIES]);
      inventoryRepo.createQueryBuilder
        // page of material ids
        .mockReturnValueOnce(summaryBuilder([{ odooProductId: 10 }]))
        // warehouse-wide summary: three materials live here, not one
        .mockReturnValueOnce(
          summaryBuilder([
            { odooProductId: 10, quantity: '100', reserved: '30', reorder: '5' },
            { odooProductId: 11, quantity: '2', reserved: '0', reorder: '5' },
            { odooProductId: 12, quantity: '0', reserved: '0', reorder: '0' },
          ]),
        );
      inventoryRepo.find.mockResolvedValue([
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'GOOD', quantity: '100', reservedQuantity: '30', reorderLevel: 5 },
      ]);

      const res = await service.listForWarehouse('w1', 1, 1);

      expect(res.inventory).toHaveLength(1);
      expect(res.summary.materials_count).toBe(3);
      // One below its reorder level, one at zero.
      expect(res.summary.critical_stock_count).toBe(2);
      expect(res.pagination.total_count).toBe(3);
      expect(res.pagination.has_next).toBe(true);
    });

    /**
     * The summary used to add kilograms to pieces.
     *
     * 100 kg of bottles plus 2 car batteries came back as "102" — a number with
     * no unit that could be written beside it, which changes if a material is
     * re-measured in tonnes without a single kilogram moving. An admin reading
     * it was reading a quantity of nothing.
     */
    it('totals stock PER UNIT and never across units', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH', code: 'W1' });
      productRepo.find.mockResolvedValue([PRODUCT, BATTERIES]);
      inventoryRepo.createQueryBuilder
        .mockReturnValueOnce(summaryBuilder([{ odooProductId: 10 }]))
        .mockReturnValueOnce(
          summaryBuilder([
            { odooProductId: 10, quantity: '100', reserved: '30', reorder: '5' },
            { odooProductId: 11, quantity: '2', reserved: '0', reorder: '5' },
          ]),
        );
      inventoryRepo.find.mockResolvedValue([]);

      const { summary } = await service.listForWarehouse('w1', 1, 10);

      expect(summary).not.toHaveProperty('total_quantity');
      expect(summary.totals_by_unit).toEqual([
        {
          id: KG.id,
          code: 'KG',
          materials_count: 1,
          total_quantity: 100,
          total_reserved: 30,
          total_available: 70,
        },
        {
          id: PIECE.id,
          code: 'PIECE',
          materials_count: 1,
          total_quantity: 2,
          total_reserved: 0,
          total_available: 2,
        },
      ]);
    });

    it('keeps a material whose unit no longer resolves, under its own code', async () => {
      // Dropping it would understate the warehouse: the stock is real whether
      // or not the unit row behind its code still exists.
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH', code: 'W1' });
      productRepo.find.mockResolvedValue([
        { id: 'p-9', name: 'Mystery', unitType: 'BALE', odooProductId: 99 },
      ]);
      inventoryRepo.createQueryBuilder
        .mockReturnValueOnce(summaryBuilder([]))
        .mockReturnValueOnce(
          summaryBuilder([
            { odooProductId: 99, quantity: '7', reserved: '1', reorder: '0' },
          ]),
        );
      inventoryRepo.find.mockResolvedValue([]);

      const { summary } = await service.listForWarehouse('w1', 1, 10);

      expect(summary.totals_by_unit).toEqual([
        {
          id: null,
          code: 'BALE',
          materials_count: 1,
          total_quantity: 7,
          total_reserved: 1,
          total_available: 6,
        },
      ]);
    });
  });

  describe('identity in the response', () => {
    it('names the grade by id and the unit by id, without the unit internals', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH', code: 'W1' });
      productRepo.findOne.mockResolvedValue(PRODUCT);
      productRepo.find.mockResolvedValue([PRODUCT]);
      inventoryRepo.find.mockResolvedValue([
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'GOOD', quantity: '10', reservedQuantity: '0', reorderLevel: 0 },
      ]);

      const res = await service.forProductInWarehouse('p-1', 'w1');

      expect(res.product.unit).toEqual({
        id: KG.id,
        code: 'KG',
      });
      // How a unit BEHAVES belongs to the units screen, not to a stock read.
      expect(res.product.unit).not.toHaveProperty('is_weight');
      expect(res.product.unit).not.toHaveProperty('allows_tolerance');
      // The grade as the single canonical object every route returns.
      expect(res.conditions[0].condition).toMatchObject({
        id: 'c-good',
        code: 'GOOD',
      });
      expect(res.conditions[0]).not.toHaveProperty('condition_id');
      expect(res.conditions[0]).not.toHaveProperty('condition_label');
    });

    it('leaves condition_id null for UNGRADED, which is a state and not a grade', async () => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH', code: 'W1' });
      productRepo.findOne.mockResolvedValue(PRODUCT);
      productRepo.find.mockResolvedValue([PRODUCT]);
      inventoryRepo.find.mockResolvedValue([
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'UNGRADED', quantity: '5', reservedQuantity: '0', reorderLevel: 0 },
      ]);

      const res = await service.forProductInWarehouse('p-1', 'w1');

      // UNGRADED stock carries no grade object at all.
      expect(res.conditions[0].condition).toBeNull();
    });
  });

  /**
   * A zero is a fact, and it is said out loud.
   *
   * "Stock fetched successfully" printed beside a quantity of 0 reads as a
   * failed lookup: the admin re-checks the material id, re-checks the
   * warehouse, and ends up asking whether the sync is broken. It is none of
   * those — the answer is that this warehouse holds none of it, and that
   * belongs in the same sentence that reports the fetch worked.
   */
  describe('saying zero out loud', () => {
    beforeEach(() => {
      warehouseRepo.findOne.mockResolvedValue({ id: 'w1', name: 'WH', code: 'W1' });
      productRepo.findOne.mockResolvedValue(PRODUCT);
      productRepo.find.mockResolvedValue([PRODUCT]);
    });

    it('says the warehouse holds none of it, not merely "successfully"', async () => {
      inventoryRepo.find.mockResolvedValue([]);

      const res = await service.forProductInWarehouse('p-1', 'w1');

      expect(res.quantity).toBe(0);
      expect(res.message).toContain('holds none');
    });

    it('says nothing extra when there IS stock', async () => {
      inventoryRepo.find.mockResolvedValue([
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'GOOD', quantity: '4', reservedQuantity: '0', reorderLevel: 0 },
      ]);

      const res = await service.forProductInWarehouse('p-1', 'w1');

      expect(res.message).not.toContain('holds none');
    });

    it('does not say it when the stock is merely all RESERVED', async () => {
      // The sentence is about what the warehouse HOLDS, not what is free. The
      // material is on the shelf, it is simply all promised — "holds none"
      // there would be false, and would send somebody looking for a delivery
      // that already arrived.
      inventoryRepo.find.mockResolvedValue([
        { warehouseId: 'w1', odooProductId: 10, conditionCode: 'GOOD', quantity: '9', reservedQuantity: '9', reorderLevel: 0 },
      ]);

      const res = await service.forProductInWarehouse('p-1', 'w1');

      expect(res.available).toBe(0);
      expect(res.quantity).toBe(9);
      expect(res.message).not.toContain('holds none');
    });
  });
});
