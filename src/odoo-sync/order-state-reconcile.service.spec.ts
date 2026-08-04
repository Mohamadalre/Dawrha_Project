import { OrderStateReconcileService } from './order-state-reconcile.service';
import { OrderPartStatus } from '@src/order/enums/order-part-status.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';

/**
 * The frozen-order case: a warehouse finished the job in Odoo and the buyer's
 * order never moved, because the one call that would have said so was dropped.
 *
 * The tests below also pin the rule that keeps a replay safe — the backend is
 * only ever moved FORWARD, never rewritten to match a stale read.
 */
describe('OrderStateReconcileService', () => {
  let service: OrderStateReconcileService;
  let odoo: any;
  let odooSync: any;
  let partRepo: any;
  let openParts: any[];
  let deadParts: any[];

  const odooOrder = (over: any = {}) => ({
    odooOrderId: 91,
    backendPartId: 'part-1',
    state: 'pending',
    managerApproval: 'pending',
    approvalRejectReason: null,
    handoverState: 'pending',
    handoverType: null,
    stockDeducted: false,
    invoiceNumber: null,
    outputZone: null,
    ...over,
  });

  const part = (status: OrderPartStatus) => ({ id: 'part-1', status });

  beforeEach(() => {
    jest.spyOn(winstonLogger, 'warn').mockImplementation(() => undefined as any);
    jest.spyOn(winstonLogger, 'info').mockImplementation(() => undefined as any);

    odoo = { fetchOpenOrderStates: jest.fn().mockResolvedValue([]) };
    odooSync = {
      enqueueOrderEvent: jest.fn().mockResolvedValue(undefined),
      enqueueCancelOrderPart: jest.fn().mockResolvedValue(undefined),
    };

    // The service makes TWO queries — settled parts (the re-cancel pass) and
    // open ones — so the mock answers by what was asked for rather than by call
    // order, which would otherwise silently feed open-part rows to both.
    openParts = [];
    deadParts = [];
    partRepo = {
      find: jest.fn(({ where }: any) => {
        const asked = where.status._value as OrderPartStatus[];
        return Promise.resolve(
          asked.includes(OrderPartStatus.CANCELLED) ? deadParts : openParts,
        );
      }),
    };

    service = new OrderStateReconcileService(partRepo, odoo, odooSync);
  });

  afterEach(() => jest.restoreAllMocks());

  it('replays the manager approval the backend never heard', async () => {
    openParts = [part(OrderPartStatus.OFFERED)];
    odoo.fetchOpenOrderStates.mockResolvedValue([
      odooOrder({ managerApproval: 'approved' }),
    ]);

    const res = await service.reconcile('manual');

    expect(res.replayed).toBe(1);
    expect(odooSync.enqueueOrderEvent).toHaveBeenCalledWith({
      partId: 'part-1',
      odooOrderId: 91,
      event: 'manager_approved',
    });
  });

  it('replays a rejection with its reason', async () => {
    openParts = [part(OrderPartStatus.OFFERED)];
    odoo.fetchOpenOrderStates.mockResolvedValue([
      odooOrder({ managerApproval: 'rejected', approvalRejectReason: 'No stock' }),
    ]);

    await service.reconcile('manual');

    expect(odooSync.enqueueOrderEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'manager_rejected', rejectReason: 'No stock' }),
    );
  });

  it('carries the invoice and output zone with a deduction', async () => {
    openParts = [part(OrderPartStatus.PROCESSING)];
    odoo.fetchOpenOrderStates.mockResolvedValue([
      odooOrder({
        state: 'ready',
        managerApproval: 'approved',
        stockDeducted: true,
        invoiceNumber: 'INV-77',
        outputZone: 'Output A',
      }),
    ]);

    await service.reconcile('manual');

    expect(odooSync.enqueueOrderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'stock_deducted',
        invoiceNumber: 'INV-77',
        outputZone: 'Output A',
      }),
    );
  });

  it('replays a handover with the type that decides its meaning', async () => {
    openParts = [part(OrderPartStatus.IN_OUTPUT_ZONE)];
    odoo.fetchOpenOrderStates.mockResolvedValue([
      odooOrder({
        state: 'completed',
        managerApproval: 'approved',
        stockDeducted: true,
        handoverState: 'handed_over',
        handoverType: 'carrier',
      }),
    ]);

    await service.reconcile('manual');

    expect(odooSync.enqueueOrderEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'handed_over', handoverType: 'carrier' }),
    );
  });

  // ── the safety rule: forward only ───────────────────────────────────────
  it('never moves a part backwards', async () => {
    // Odoo shows an approval; the backend is already three steps past it.
    openParts = [part(OrderPartStatus.IN_OUTPUT_ZONE)];
    odoo.fetchOpenOrderStates.mockResolvedValue([
      odooOrder({ managerApproval: 'approved' }),
    ]);

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueOrderEvent).not.toHaveBeenCalled();
    expect(res.replayed).toBe(0);
  });

  it('does nothing when both sides already agree', async () => {
    openParts = [part(OrderPartStatus.ACCEPTED)];
    odoo.fetchOpenOrderStates.mockResolvedValue([
      odooOrder({ managerApproval: 'approved' }),
    ]);

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueOrderEvent).not.toHaveBeenCalled();
    expect(res.replayed).toBe(0);
  });

  it('ignores an order the warehouse has not started on', async () => {
    openParts = [part(OrderPartStatus.OFFERED)];
    odoo.fetchOpenOrderStates.mockResolvedValue([odooOrder()]);

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueOrderEvent).not.toHaveBeenCalled();
    expect(res.replayed).toBe(0);
  });

  it('leaves a part Odoo has never seen to the push reconciler', async () => {
    openParts = [part(OrderPartStatus.OFFERED)];
    odoo.fetchOpenOrderStates.mockResolvedValue([]); // not in Odoo at all

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueOrderEvent).not.toHaveBeenCalled();
    expect(res.replayed).toBe(0);
  });

  it('survives Odoo being unreachable', async () => {
    openParts = [part(OrderPartStatus.OFFERED)];
    odoo.fetchOpenOrderStates.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(service.reconcile('cron')).resolves.toEqual({ replayed: 0, recancelled: 0 });
  });

  it('only ever looks at parts that are still moving', async () => {
    await service.reconcile('manual');

    const queries = partRepo.find.mock.calls.map((c: any) => c[0].where);
    const open = queries.find((w: any) =>
      (w.status._value as OrderPartStatus[]).includes(OrderPartStatus.OFFERED),
    ).status._value as OrderPartStatus[];
    expect(open).toContain(OrderPartStatus.OFFERED);
    expect(open).toContain(OrderPartStatus.DISPATCHED);
    // Finished business — re-reading these for ever buys nothing.
    expect(open).not.toContain(OrderPartStatus.DELIVERED);
    expect(open).not.toContain(OrderPartStatus.CANCELLED);
    expect(open).not.toContain(OrderPartStatus.REJECTED);
  });

  // ── the withdrawn order Odoo is still working on ──────────────────────
  it('re-cancels an order the buyer withdrew that Odoo still shows as live', async () => {
    // Nothing else catches this: every other pass walks parts that are still
    // moving, and a cancelled part is by definition not one of those.
    deadParts = [part(OrderPartStatus.CANCELLED)];
    odoo.fetchOpenOrderStates.mockResolvedValue([odooOrder({ state: 'processing' })]);

    const res = await service.reconcile('manual');

    expect(res.recancelled).toBe(1);
    expect(odooSync.enqueueCancelOrderPart).toHaveBeenCalledWith(
      expect.objectContaining({ partId: 'part-1' }),
    );
  });

  it('does not re-cancel when Odoo already knows it is over', async () => {
    deadParts = [part(OrderPartStatus.CANCELLED)];
    odoo.fetchOpenOrderStates.mockResolvedValue([odooOrder({ state: 'cancelled' })]);

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueCancelOrderPart).not.toHaveBeenCalled();
    expect(res.recancelled).toBe(0);
  });
});
