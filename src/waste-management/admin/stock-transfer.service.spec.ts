import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StockTransferService } from './stock-transfer.service';

/**
 * Re-grading stock that is already in a warehouse.
 *
 * A re-inspection changes the answer: material graded GOOD on arrival turns out
 * to be EXCELLENT. Without this the only ways out were to write it off and
 * re-receive it — inventing a delivery that never happened — or to leave the
 * stock mislabelled and therefore mispriced.
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
 *   the source grade SURVIVES emptying — an empty grade is still one the
 *   material is sold at.
 */
describe('StockTransferService', () => {
  let service: StockTransferService;
  let productRepo: any;
  let conditionRepo: any;
  let inventoryRepo: any;
  let audit: any;
  let odooSync: any;
  let dataSource: any;

  const PRODUCT = { id: 'prod-1', name: 'PET', odooProductId: 10 };
  const GOOD = { id: 'c-good', productId: 'prod-1', code: 'GOOD' };
  const EXCELLENT = { id: 'c-exc', productId: 'prod-1', code: 'EXCELLENT' };
  const OTHER_MATERIAL_GRADE = { id: 'c-other', productId: 'prod-2', code: 'GOOD' };

  const saved: any[] = [];

  const sourceRow = (quantity: string, reserved: string) => ({
    id: 'inv-good',
    warehouseId: 'wh-1',
    odooProductId: 10,
    conditionCode: 'GOOD',
    quantity,
    reservedQuantity: reserved,
  });

  beforeEach(() => {
    saved.length = 0;
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
      create: jest.fn((x: any) => ({ ...x })),
      save: jest.fn(async (x: any) => { saved.push({ ...x }); return x; }),
    };
    audit = { record: jest.fn() };
    odooSync = { enqueueSyncWarehouse: jest.fn() };
    dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({ getRepository: () => inventoryRepo }),
      ),
    };

    service = new StockTransferService(
      productRepo, conditionRepo, inventoryRepo, audit, odooSync, dataSource,
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
  it('moves the quantity between two grades of the same material', async () => {
    const res: any = await transfer();

    expect(res.moved).toBe(50);
    // 100 held − 50 moved
    expect(res.from.remaining).toBe(50);
    expect(res.to.total).toBe(50);
  });

  it('refuses grades that belong to different materials', async () => {
    // "GOOD" names a different thing for each material; moving between them
    // would shift quantity between two unrelated things.
    await expect(
      transfer({ toConditionId: 'c-other' }),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  // ------------------------------------------------------------------
  // Reserved stock
  // ------------------------------------------------------------------
  it('moves UNRESERVED quantity even while some is reserved', async () => {
    // 100 held, 30 reserved → 70 movable. Refusing outright would freeze the
    // whole grade because of one small order.
    const res: any = await transfer({ quantity: 70 });

    expect(res.moved).toBe(70);
    expect(res.reserved_untouched).toBe(30);
  });

  it('refuses to move into the reserved quantity', async () => {
    // 71 of 70 movable: the extra kilogram is promised to an order that has
    // not shipped, and moving it surfaces as a shortage at deduction time —
    // after the buyer was told yes.
    await expect(transfer({ quantity: 71 })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('says WHY it refused — reservation, not absence', async () => {
    // "not enough stock" would send the admin looking for material that is in
    // fact sitting right there, spoken for.
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
  });

  // ------------------------------------------------------------------
  // The source grade survives
  // ------------------------------------------------------------------
  it('keeps the source grade row when the last of it moves out', async () => {
    // An empty grade is still a grade this material is sold at. Deleting it
    // because today's stock ran out would change the price sheet and every
    // sorting screen behind the admin's back.
    inventoryRepo.delete = jest.fn();
    inventoryRepo.remove = jest.fn();
    inventoryRepo.findOne = jest.fn(async ({ where }: any) =>
      where.conditionCode === 'GOOD' ? sourceRow('100', '0') : null,
    );

    const res: any = await transfer({ quantity: 100 });

    expect(res.from.remaining).toBe(0);
    // The row was written back at zero, not removed.
    expect(saved.some((r) => r.conditionCode === 'GOOD' && Number(r.quantity) === 0)).toBe(true);
    expect(inventoryRepo.delete).not.toHaveBeenCalled();
    expect(inventoryRepo.remove).not.toHaveBeenCalled();
  });

  it('tells Odoo, which is the only writer of quantities', async () => {
    await transfer();
    expect(odooSync.enqueueSyncWarehouse).toHaveBeenCalled();
  });

  it('records who moved what, and why', async () => {
    await transfer();
    const call = audit.record.mock.calls[0][0];
    expect(call.action).toBe('TRANSFER_STOCK_BETWEEN_GRADES');
    expect(call.newValues.reason).toBe('Re-inspected');
  });
});
