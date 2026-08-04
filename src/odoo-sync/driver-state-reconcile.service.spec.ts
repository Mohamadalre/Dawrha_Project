import { DriverStateReconcileService } from './driver-state-reconcile.service';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { statusMedia } from '@src/media/entities/media.entity';
import { winstonLogger } from '@src/core/logger-config/winston.config';

/**
 * The split-brain cases this service exists for.
 *
 * Each test states a concrete disagreement between the two systems and asserts
 * which way it is resolved — because the answer is deliberately NOT the same in
 * both directions (see the class docstring), and getting it backwards would
 * either strand drivers for ever or kick working ones out of the app.
 */
describe('DriverStateReconcileService', () => {
  let service: DriverStateReconcileService;
  let odoo: any;
  let odooSync: any;
  let accountRepo: any;
  let collectorRepo: any;
  let mediaRepo: any;

  /** Older than the grace window, so the row counts as settled. */
  const SETTLED = new Date(Date.now() - 60 * 60 * 1000);
  /** Just written — a webhook could still be in flight. */
  const FRESH = new Date();

  /** An Odoo image; url defaults to the SAME file the backend holds. */
  const img = (over: any = {}) => ({
    backendMediaId: 'm-1', status: 'rejected', reuploadRequested: true,
    url: 'https://cdn/same.jpg', ...over,
  });

  const odooState = (over: any = {}) => ({
    backendDriverId: 'driver-1',
    state: 'accepted',
    isBlocked: false,
    rejectionReason: null,
    warehouseOdooId: 7,
    shiftOdooId: null,
    images: [],
    ...over,
  });

  const profile = (status: AccountStatus, updatedAt = SETTLED) => ({
    id: 'driver-1',
    account: { id: 'acc-1', accountStatus: status, updatedAt },
  });

  beforeEach(() => {
    jest.spyOn(winstonLogger, 'warn').mockImplementation(() => undefined as any);
    jest.spyOn(winstonLogger, 'info').mockImplementation(() => undefined as any);

    odoo = { fetchDriverRequestStates: jest.fn().mockResolvedValue([]) };
    odooSync = {
      enqueueDriverDecision: jest.fn().mockResolvedValue(undefined),
      enqueuePushDriverRequestReconcile: jest.fn().mockResolvedValue(undefined),
    };
    accountRepo = { find: jest.fn() };
    collectorRepo = { find: jest.fn().mockResolvedValue([]) };
    mediaRepo = { find: jest.fn().mockResolvedValue([]) };

    service = new DriverStateReconcileService(
      accountRepo,
      collectorRepo,
      mediaRepo,
      odoo,
      odooSync,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  // ── the case that never self-heals ──────────────────────────────────────
  it('replays an accepted decision the backend never received', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([odooState()]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.PENDING_APPROVAL)]);

    const res = await service.reconcile('manual');

    expect(res.converged).toBe(1);
    expect(odooSync.enqueueDriverDecision).toHaveBeenCalledWith({
      backendDriverId: 'driver-1',
      status: AccountStatus.ACTIVE,
      warehouseOdooId: 7,
    });
  });

  it('replays a rejection with its reason', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([
      odooState({ state: 'rejected', rejectionReason: 'Licence expired', warehouseOdooId: null }),
    ]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.PENDING_APPROVAL)]);

    await service.reconcile('manual');

    expect(odooSync.enqueueDriverDecision).toHaveBeenCalledWith({
      backendDriverId: 'driver-1',
      status: AccountStatus.REJECTED,
      rejectionReason: 'Licence expired',
    });
  });

  it('treats a blocked flag as BLOCKED even though the request is accepted', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([odooState({ isBlocked: true })]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.ACTIVE)]);

    await service.reconcile('manual');

    expect(odooSync.enqueueDriverDecision).toHaveBeenCalledWith(
      expect.objectContaining({ status: AccountStatus.BLOCKED }),
    );
  });

  it('replays NEED_CHANGES as a re-upload request for the asked-for documents only', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([
      odooState({
        state: 'need_changes',
        rejectionReason: 'Blurry licence',
        images: [
          img({ backendMediaId: 'm-asked', reuploadRequested: true }),
          img({ backendMediaId: 'm-quiet', reuploadRequested: false }),
        ],
      }),
    ]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.PENDING_APPROVAL)]);

    await service.reconcile('manual');

    expect(odooSync.enqueueDriverDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AccountStatus.NEED_CHANGES,
        // Only the document he was actually TOLD about.
        rejectedMediaIds: ['m-asked'],
        requestReupload: true,
      }),
    );
  });

  // ── the case that DOES self-heal: never revert a live account ───────────
  it('does not touch an ACTIVE driver while Odoo still shows the request pending', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([odooState({ state: 'pending' })]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.ACTIVE)]);

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueDriverDecision).not.toHaveBeenCalled();
    expect(res.converged).toBe(0);
    expect(res.reported).toBe(1); // named in the log for an operator
  });

  // ── quiet when everything agrees ────────────────────────────────────────
  it('does nothing when the two systems already agree', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([odooState()]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.ACTIVE)]);

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueDriverDecision).not.toHaveBeenCalled();
    expect(res).toEqual({ converged: 0, reported: 0, repushed: 0 });
  });

  it('leaves a just-decided row alone — the webhook may still be in flight', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([odooState()]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.PENDING_APPROVAL, FRESH)]);

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueDriverDecision).not.toHaveBeenCalled();
    expect(res.converged).toBe(0);
  });

  // ── documents ───────────────────────────────────────────────────────────
  it('converges a document Odoo rejected that the backend still shows PENDING', async () => {
    // Status agrees on both sides — only the document judgement drifted, which
    // matters because the driver's re-upload route refuses a non-REJECTED file.
    odoo.fetchDriverRequestStates.mockResolvedValue([
      odooState({
        state: 'need_changes',
        images: [img()],
      }),
    ]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.NEED_CHANGES)]);
    mediaRepo.find.mockResolvedValue([
      // SAME file as Odoo holds — so nothing was replaced here.
      { id: 'm-1', url: 'https://cdn/same.jpg', status: statusMedia.PENDING, reuploadRequestedAt: null },
    ]);

    const res = await service.reconcile('manual');

    expect(res.converged).toBe(1);
    expect(odooSync.enqueueDriverDecision).toHaveBeenCalledWith(
      expect.objectContaining({ rejectedMediaIds: ['m-1'], requestReupload: true }),
    );
  });

  // ── the driver's own answer: backend → Odoo ─────────────────────────────
  it('re-pushes when the driver replaced a document and Odoo still has the old file', async () => {
    // The lost re-push. Note the backend row is PENDING with no outstanding
    // request — byte-for-byte what "never heard the rejection" looks like. Only
    // the URL says which of the two actually happened.
    odoo.fetchDriverRequestStates.mockResolvedValue([
      odooState({ state: 'need_changes', images: [img()] }),
    ]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.PENDING_APPROVAL)]);
    mediaRepo.find.mockResolvedValue([
      { id: 'm-1', url: 'https://cdn/NEW.jpg', status: statusMedia.PENDING, reuploadRequestedAt: null },
    ]);

    const res = await service.reconcile('manual');

    expect(res.repushed).toBe(1);
    expect(odooSync.enqueuePushDriverRequestReconcile).toHaveBeenCalledWith('acc-1');
    // Crucially NOT a decision replay: that would drag a driver who has
    // already answered everything back into NEED_CHANGES.
    expect(odooSync.enqueueDriverDecision).not.toHaveBeenCalled();
  });

  it('does not re-push when the file is unchanged', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([
      odooState({ state: 'need_changes', images: [img()] }),
    ]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.NEED_CHANGES)]);
    mediaRepo.find.mockResolvedValue([
      { id: 'm-1', url: 'https://cdn/same.jpg', status: statusMedia.REJECTED, reuploadRequestedAt: new Date() },
    ]);

    const res = await service.reconcile('manual');

    expect(res.repushed).toBe(0);
    expect(odooSync.enqueuePushDriverRequestReconcile).not.toHaveBeenCalled();
  });

  it('does not converge when the documents already match', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([
      odooState({
        state: 'need_changes',
        images: [img()],
      }),
    ]);
    collectorRepo.find.mockResolvedValue([profile(AccountStatus.NEED_CHANGES)]);
    mediaRepo.find.mockResolvedValue([
      { id: 'm-1', status: statusMedia.REJECTED, reuploadRequestedAt: new Date() },
    ]);

    const res = await service.reconcile('manual');

    expect(odooSync.enqueueDriverDecision).not.toHaveBeenCalled();
    expect(res.converged).toBe(0);
  });

  // ── resilience: this runs on a timer and must never die ─────────────────
  it('survives Odoo being unreachable', async () => {
    odoo.fetchDriverRequestStates.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.reconcile('cron')).resolves.toEqual({ converged: 0, reported: 0, repushed: 0 });
    expect(odooSync.enqueueDriverDecision).not.toHaveBeenCalled();
  });

  it('ignores an Odoo request for a driver this backend does not have', async () => {
    odoo.fetchDriverRequestStates.mockResolvedValue([odooState({ backendDriverId: 'ghost' })]);
    collectorRepo.find.mockResolvedValue([]);

    const res = await service.reconcile('manual');

    expect(res.converged).toBe(0);
    expect(odooSync.enqueueDriverDecision).not.toHaveBeenCalled();
  });
});
