import { ConflictException } from '@nestjs/common';
import { OrderViewService } from './order-view.service';
import { OrderPartStatus } from '../enums/order-part-status.enum';
import { OrderStatus } from '../enums/order-status.enum';
import { ComplaintKind, ComplaintRoute } from '../enums/complaint-kind.enum';

/**
 * Filing a complaint routes it by what it is about: a shortage or a quality
 * problem is the warehouse's to answer (its deduction log is the evidence), so
 * the warehouse manager is notified in Odoo; delivery and billing stay with the
 * platform admin and are NOT pushed to a warehouse.
 */
describe('OrderViewService.fileComplaint routing', () => {
  const build = (partStatus = OrderPartStatus.DELIVERED, odooWarehouseId: number | null = 55) => {
    const complaints: any[] = [];
    const partRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'p-1', orderId: 'ord-1', warehouseId: 'wh-1', status: partStatus,
      }),
    };
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'ord-1', orderNumber: 'ORD-1', buyerAccountId: 'acc-1',
      }),
    };
    const complaintRepo = {
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => {
        const row = { id: 'c-1', ...x };
        complaints.push(row);
        return row;
      }),
      findOne: jest.fn(async () => complaints[0] ?? null),
    };
    const warehouseRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'wh-1', odooWarehouseId }),
    };
    const odooSync = { enqueuePushComplaint: jest.fn() };
    const trips = { consolidationEligibility: jest.fn().mockResolvedValue({ available: false }) };
    const wallet = { awardForOrder: jest.fn().mockResolvedValue(null) };
    const svc = new OrderViewService(
      orderRepo as any, partRepo as any, {} as any, {} as any,
      complaintRepo as any, warehouseRepo as any, odooSync as any, trips as any, wallet as any,
    );
    return { svc, odooSync, complaints };
  };

  it('notifies the warehouse in Odoo for a SHORTAGE (warehouse-routed) complaint', async () => {
    const { svc, odooSync, complaints } = build();
    const res: any = await svc.fileComplaint('acc-1', 'p-1', {
      kind: ComplaintKind.SHORTAGE,
      description: 'Missing 10 kg',
    });
    expect(res.routed_to).toBe(ComplaintRoute.WAREHOUSE);
    expect(complaints[0].route).toBe(ComplaintRoute.WAREHOUSE);
    expect(odooSync.enqueuePushComplaint).toHaveBeenCalledTimes(1);
    expect(odooSync.enqueuePushComplaint.mock.calls[0][0]).toMatchObject({
      odooWarehouseId: 55,
      kind: ComplaintKind.SHORTAGE,
      orderNumber: 'ORD-1',
    });
  });

  it('does NOT push a DELIVERY (admin-routed) complaint to a warehouse', async () => {
    const { svc, odooSync } = build();
    const res: any = await svc.fileComplaint('acc-1', 'p-1', {
      kind: ComplaintKind.DELIVERY,
      description: 'Arrived late',
    });
    expect(res.routed_to).toBe(ComplaintRoute.ADMIN);
    expect(odooSync.enqueuePushComplaint).not.toHaveBeenCalled();
  });

  it('does not push when the warehouse is not mirrored in Odoo', async () => {
    const { svc, odooSync } = build(OrderPartStatus.DELIVERED, null);
    await svc.fileComplaint('acc-1', 'p-1', {
      kind: ComplaintKind.QUALITY,
      description: 'Wrong grade',
    });
    expect(odooSync.enqueuePushComplaint).not.toHaveBeenCalled();
  });

  it('refuses a complaint before the goods are handed over', async () => {
    const { svc } = build(OrderPartStatus.DISPATCHED);
    await expect(
      svc.fileComplaint('acc-1', 'p-1', {
        kind: ComplaintKind.SHORTAGE,
        description: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * A complaint is filed against the WHOLE order (what the buyer sees), and a
 * warehouse-routed one fans out to every warehouse that fulfilled it.
 */
describe('OrderViewService.fileOrderComplaint (whole-order scope)', () => {
  const build = (orderStatus = OrderStatus.DELIVERED) => {
    const complaints: any[] = [];
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'ord-1', orderNumber: 'ORD-1', buyerAccountId: 'acc-1', status: orderStatus,
      }),
    };
    const partRepo = {
      // The order was split across two warehouses.
      find: jest.fn().mockResolvedValue([
        { id: 'p-1', orderId: 'ord-1', warehouseId: 'wh-1', status: OrderPartStatus.DELIVERED },
        { id: 'p-2', orderId: 'ord-1', warehouseId: 'wh-2', status: OrderPartStatus.DELIVERED },
      ]),
    };
    const complaintRepo = {
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => {
        const row = { id: 'c-1', ...x };
        complaints.push(row);
        return row;
      }),
      findOne: jest.fn(async () => complaints[0] ?? null),
    };
    const warehouseRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'wh-1', odooWarehouseId: 55 },
        { id: 'wh-2', odooWarehouseId: 66 },
      ]),
    };
    const odooSync = { enqueuePushComplaint: jest.fn() };
    const svc = new OrderViewService(
      orderRepo as any, partRepo as any, {} as any, {} as any,
      complaintRepo as any, warehouseRepo as any, odooSync as any, {} as any, {} as any,
    );
    return { svc, odooSync, complaints };
  };

  it('files ONE complaint against the order with no part or single warehouse', async () => {
    const { svc, complaints } = build();
    const res: any = await svc.fileOrderComplaint('acc-1', 'ord-1', {
      kind: ComplaintKind.SHORTAGE,
      description: 'Two things missing across the order',
    });
    expect(res.order_id).toBe('ord-1');
    expect(complaints).toHaveLength(1);
    expect(complaints[0].orderId).toBe('ord-1');
    expect(complaints[0].partId).toBeUndefined();
    expect(complaints[0].warehouseId).toBeUndefined();
  });

  it('fans a warehouse-routed complaint out to EVERY fulfilling warehouse', async () => {
    const { svc, odooSync } = build();
    await svc.fileOrderComplaint('acc-1', 'ord-1', {
      kind: ComplaintKind.QUALITY,
      description: 'Grade wrong on both parts',
    });
    expect(odooSync.enqueuePushComplaint).toHaveBeenCalledTimes(2);
    const ids = odooSync.enqueuePushComplaint.mock.calls.map((c: any[]) => c[0].odooWarehouseId).sort();
    expect(ids).toEqual([55, 66]);
  });

  it('does NOT fan out an admin-routed (billing) complaint', async () => {
    const { svc, odooSync } = build();
    const res: any = await svc.fileOrderComplaint('acc-1', 'ord-1', {
      kind: ComplaintKind.BILLING,
      description: 'Charged twice',
    });
    expect(res.routed_to).toBe(ComplaintRoute.ADMIN);
    expect(odooSync.enqueuePushComplaint).not.toHaveBeenCalled();
  });

  it('refuses an order complaint before the goods are handed over', async () => {
    const { svc } = build(OrderStatus.IN_TRANSIT);
    await expect(
      svc.fileOrderComplaint('acc-1', 'ord-1', {
        kind: ComplaintKind.SHORTAGE,
        description: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
