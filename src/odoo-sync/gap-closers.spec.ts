import { ShiftChangeStateReconcileService } from './shift-change-state-reconcile.service';
import { OrphanReconcileService } from './orphan-reconcile.service';
import { PushReconcileService } from './push-reconcile.service';
import { ShiftChangeRequestStatus } from '@src/truck/enums/shift-change-request-status.enum';
import { OrderPartStatus } from '@src/order/enums/order-part-status.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';

/**
 * The three channels found by a full inventory of every exchange between the
 * two systems — each of which could leave a record in one and not the other.
 */
describe('sync gap closers', () => {
  beforeEach(() => {
    jest.spyOn(winstonLogger, 'warn').mockImplementation(() => undefined as any);
    jest.spyOn(winstonLogger, 'info').mockImplementation(() => undefined as any);
  });
  afterEach(() => jest.restoreAllMocks());

  // ── 1. the order part a warehouse was never told about ─────────────────
  describe('PushReconcile — order parts', () => {
    const build = (rows: any[]) => {
      const repo = () => ({ find: jest.fn().mockResolvedValue([]) });
      const partRepo = { find: jest.fn().mockResolvedValue(rows) };
      const odooSync = {
        enqueuePushShiftChange: jest.fn(),
        enqueuePushTruckProblem: jest.fn(),
        enqueuePushHandoverPickup: jest.fn(),
        enqueuePushHandoverDropoff: jest.fn(),
        enqueuePushOrderPart: jest.fn().mockResolvedValue(undefined),
      };
      return {
        svc: new PushReconcileService(repo() as any, repo() as any, repo() as any, partRepo as any, odooSync as any),
        odooSync,
        partRepo,
      };
    };

    it('re-pushes a live part Odoo never received', async () => {
      const { svc, odooSync } = build([{ id: 'part-1', status: OrderPartStatus.OFFERED }]);

      await svc.scheduledReconcile();

      expect(odooSync.enqueuePushOrderPart).toHaveBeenCalledWith({ partId: 'part-1' });
    });

    it('only looks at parts still worth pushing', async () => {
      const { svc, partRepo } = build([]);

      await svc.scheduledReconcile();

      const where = partRepo.find.mock.calls[0][0].where;
      const live = where.status._value as OrderPartStatus[];
      expect(live).toContain(OrderPartStatus.OFFERED);
      // Pushing these would put dead work on a warehouse's screen.
      expect(live).not.toContain(OrderPartStatus.REJECTED);
      expect(live).not.toContain(OrderPartStatus.DELIVERED);
      expect(live).not.toContain(OrderPartStatus.CANCELLED);
      expect(where.odooOrderId._type).toBe('isNull');
    });
  });

  // ── 2. the manager's shift-change answer that never arrived ────────────
  describe('ShiftChangeStateReconcile', () => {
    const build = (rows: any[], states: any[]) => {
      const requestRepo = { find: jest.fn().mockResolvedValue(rows) };
      const odoo = { fetchShiftChangeStates: jest.fn().mockResolvedValue(states) };
      const odooSync = { enqueueShiftChangeDecision: jest.fn().mockResolvedValue(undefined) };
      return {
        svc: new ShiftChangeStateReconcileService(requestRepo as any, odoo as any, odooSync as any),
        odooSync,
        odoo,
      };
    };

    it('replays an acceptance the driver never heard', async () => {
      const { svc, odooSync } = build(
        [{ id: 'r-1', status: ShiftChangeRequestStatus.PENDING }],
        [{ backendRequestId: 'r-1', state: 'accepted', rejectionReason: null, truckOdooId: 12 }],
      );

      const res = await svc.reconcile('manual');

      expect(res.converged).toBe(1);
      expect(odooSync.enqueueShiftChangeDecision).toHaveBeenCalledWith({
        requestId: 'r-1', status: 'ACCEPTED', truckOdooId: 12,
      });
    });

    it('replays a rejection with its reason', async () => {
      const { svc, odooSync } = build(
        [{ id: 'r-1', status: ShiftChangeRequestStatus.PROCESSING }],
        [{ backendRequestId: 'r-1', state: 'rejected', rejectionReason: 'No spare truck', truckOdooId: null }],
      );

      await svc.reconcile('manual');

      expect(odooSync.enqueueShiftChangeDecision).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'REJECTED', rejectionReason: 'No spare truck' }),
      );
    });

    it('leaves an undecided request alone', async () => {
      const { svc, odooSync } = build(
        [{ id: 'r-1', status: ShiftChangeRequestStatus.PENDING }],
        [{ backendRequestId: 'r-1', state: 'pending', rejectionReason: null, truckOdooId: null }],
      );

      const res = await svc.reconcile('manual');

      expect(odooSync.enqueueShiftChangeDecision).not.toHaveBeenCalled();
      expect(res.converged).toBe(0);
    });

    it('leaves a request Odoo never received to the push reconciler', async () => {
      const { svc, odooSync } = build([{ id: 'r-1', status: ShiftChangeRequestStatus.PENDING }], []);

      await svc.reconcile('manual');

      expect(odooSync.enqueueShiftChangeDecision).not.toHaveBeenCalled();
    });

    it('survives Odoo being unreachable', async () => {
      const { svc, odoo } = build([{ id: 'r-1', status: ShiftChangeRequestStatus.PENDING }], []);
      odoo.fetchShiftChangeStates.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(svc.reconcile('cron')).resolves.toEqual({ converged: 0, reported: 0 });
    });
  });

  // ── 3. the delete that never landed, leaving a row only Odoo has ───────
  describe('OrphanReconcile', () => {
    const build = (odooIds: any, known: Record<string, any[]>) => {
      const repo = (rows: any[]) => ({ find: jest.fn().mockResolvedValue(rows) });
      const odoo = { fetchCatalogueIds: jest.fn().mockResolvedValue(odooIds) };
      return {
        svc: new OrphanReconcileService(
          repo(known.categories ?? []) as any,
          repo(known.products ?? []) as any,
          repo(known.units ?? []) as any,
          repo(known.conditions ?? []) as any,
          odoo as any,
        ),
        odoo,
      };
    };

    it('finds an Odoo row the backend no longer has', async () => {
      const { svc } = build(
        { categories: [1, 2], products: [], units: [], conditions: [] },
        { categories: [{ odooCategoryId: 1 }] }, // 2 was deleted here, never there
      );

      const report = await svc.findOrphans('manual');

      expect(report.categories).toEqual([2]);
      expect(report.total).toBe(1);
    });

    it('reports rather than deletes — the blast radius is the whole catalogue', async () => {
      const { svc } = build(
        { categories: [9], products: [], units: [], conditions: [] },
        { categories: [] },
      );

      const report = await svc.findOrphans('manual');

      // The contract is a report an admin acts on; nothing here removes data.
      expect(report.categories).toEqual([9]);
      expect(Object.keys(svc)).not.toContain('delete');
    });

    it('is silent when both sides match', async () => {
      const { svc } = build(
        { categories: [1], products: [5], units: [], conditions: [] },
        { categories: [{ odooCategoryId: 1 }], products: [{ odooProductId: 5 }] },
      );

      const report = await svc.findOrphans('manual');

      expect(report.total).toBe(0);
    });

    it('survives Odoo being unreachable', async () => {
      const { svc, odoo } = build({ categories: [], products: [], units: [], conditions: [] }, {});
      odoo.fetchCatalogueIds.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(svc.findOrphans('cron')).resolves.toMatchObject({ total: 0 });
    });
  });
});
