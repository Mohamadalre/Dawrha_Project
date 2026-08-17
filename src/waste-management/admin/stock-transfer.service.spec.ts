import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StockTransferService } from './stock-transfer.service';

/**
 * Re-grading stock that is already in a warehouse.
 *
 * The move itself happens in Odoo — the sole writer of quantities — so these
 * tests assert what the SERVICE owns: it validates the request, pre-checks the
 * mirror for a fast error, records the intent, and QUEUES the Odoo write. It
 * must never touch the mirror itself: the old version did, and the very
 * warehouse re-sync it asked for read Odoo's unchanged grades straight back over
 * the move, reverting it silently. The regression guard is the last test.
 *
 * Three rules are pinned here, each for a specific way this goes wrong:
 *
 *   grades must share a MATERIAL — a code is unique only within one, so "GOOD"
 *   names a different thing for paper than for copper;
 *
 *   only UNRESERVED quantity moves — reserved stock is promised to an order
 *   that has not shipped, and moving it leaves that order pointing at a grade
 *   its goods are no longer in;
 *
 *   the move goes to ODOO over the QUEUE, and the mirror is never mutated here.
 */
describe('StockTransferService', () => {
  let service: StockTransferService;
  let productRepo: any;
  let conditionRepo: any;
  let inventoryRepo: any;
  let warehouseRepo: any;
  let audit: any;
  let odooSync: any;

  const PRODUCT = { id: 'prod-1', name: 'PET', odooProductId: 10 };
  const WAREHOUSE = { id: 'wh-1', odooWarehouseId: 3 };
  const GOOD = { id: 'c-good', productId: 'prod-1', code: 'GOOD' };
  const EXCELLENT = { id: 'c-exc', productId: 'prod-1', code: 'EXCELLENT' };
  const OTHER_MATERIAL_GRADE = { id: 'c-other', productId: 'prod-2', code: 'GOOD' };

  const sourceRow = (quantity: string, reserved: string) => ({
    id: 'inv-good',
    warehouseId: 'wh-1',
    odooProductId: 10,
    conditionCode: 'GOOD',
    quantity,
    reservedQuantity: reserved,
  });

  beforeEach(() => {
    productRepo = { findOne: jest.fn().mockResolvedValue(PRODUCT) };
    conditionRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        [GOOD, EXCELLENT, OTHER_MATERIAL_GRADE].find((c) => c.id === where.id) ?? null,
      ),
    };
    inventoryRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.conditionCode === 'GOOD' ? sourceRow('100', '30') : null,
      ),
      // Present so the test would FAIL loudly if the service ever wrote the
      // mirror again — it must not.
      save: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };
    warehouseRepo = { findOne: jest.fn().mockResolvedValue(WAREHOUSE) };
    audit = { record: jest.fn() };
    odooSync = { enqueueTransferStockGrade: jest.fn() };

    service = new StockTransferService(
      productRepo, conditionRepo, inventoryRepo, warehouseRepo, audit, odooSync,
    );
  });

  const transfer = (over: Partial<any> = {}) =>
    service.transfer('admin-1', 'prod-1', {
      warehouseId: 'wh-1',
      fromConditionId: 'c-good',
      toConditionId: 'c-exc',
      quantity: 50,
      reason: 'Re-inspected',
      ...over,
    });

  // ------------------------------------------------------------------
  it('queues the move in Odoo with the resolved codes and Odoo ids', async () => {
    const res: any = await transfer();

    expect(odooSync.enqueueTransferStockGrade).toHaveBeenCalledTimes(1);
    const payload = odooSync.enqueueTransferStockGrade.mock.calls[0][0];
    expect(payload).toMatchObject({
      warehouseId: 'wh-1',
      warehouseOdooId: 3,
      odooProductId: 10,
      fromCondition: 'GOOD',
      toCondition: 'EXCELLENT',
      quantity: 50,
      adminId: 'admin-1',
    });
    expect(res.quantity).toBe(50);
    expect(res.from.code).toBe('GOOD');
    expect(res.to.code).toBe('EXCELLENT');
  });

  it('never mutates the mirror — Odoo is the sole writer', async () => {
    await transfer();
    // The whole bug was moving the mirror and having the sync revert it. The
    // service must not write inventory at all now.
    expect(inventoryRepo.save).not.toHaveBeenCalled();
    expect(inventoryRepo.create).not.toHaveBeenCalled();
    expect(inventoryRepo.delete).not.toHaveBeenCalled();
  });

  it('refuses grades that belong to different materials', async () => {
    await expect(
      transfer({ toConditionId: 'c-other' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(odooSync.enqueueTransferStockGrade).not.toHaveBeenCalled();
  });

  it('refuses when the source and destination are the same grade', async () => {
    await expect(
      transfer({ toConditionId: 'c-good' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a grade that does not exist', async () => {
    await expect(
      transfer({ fromConditionId: 'c-nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses when the warehouse is not mirrored in Odoo', async () => {
    warehouseRepo.findOne.mockResolvedValue({ id: 'wh-1', odooWarehouseId: null });
    await expect(transfer()).rejects.toBeInstanceOf(BadRequestException);
    expect(odooSync.enqueueTransferStockGrade).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Reserved stock — pre-checked against the mirror
  // ------------------------------------------------------------------
  it('queues UNRESERVED quantity even while some is reserved', async () => {
    // 100 held, 30 reserved → 70 movable.
    const res: any = await transfer({ quantity: 70 });

    expect(odooSync.enqueueTransferStockGrade).toHaveBeenCalledTimes(1);
    expect(res.quantity).toBe(70);
    expect(res.reserved_untouched).toBe(30);
  });

  it('refuses to move into the reserved quantity', async () => {
    // 71 of 70 movable: the extra kilogram is promised to an order that has
    // not shipped.
    await expect(transfer({ quantity: 71 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(odooSync.enqueueTransferStockGrade).not.toHaveBeenCalled();
  });

  it('says WHY it refused — reservation, not absence', async () => {
    const err: any = await transfer({ quantity: 90 }).catch((e) => e);
    expect(String(err.message)).toContain('reserved');
  });

  it('keeps refusal messages free of interpolated numbers', async () => {
    // The error filter translates by exact match on the whole sentence, so a
    // number spliced into one strands every Arabic caller with English.
    const err: any = await transfer({ quantity: 90 }).catch((e) => e);
    expect(String(err.message)).not.toMatch(/\d/);
  });

  it('refuses when the warehouse holds none of the source grade', async () => {
    inventoryRepo.findOne.mockResolvedValue(null);
    await expect(transfer()).rejects.toBeInstanceOf(NotFoundException);
    expect(odooSync.enqueueTransferStockGrade).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  it('records who asked for the move, and why', async () => {
    await transfer();
    const call = audit.record.mock.calls[0][0];
    expect(call.action).toBe('TRANSFER_STOCK_BETWEEN_GRADES');
    expect(call.newValues.reason).toBe('Re-inspected');
  });
});
