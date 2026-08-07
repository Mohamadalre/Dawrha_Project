import { OfferMirrorReconcileService } from './offer-mirror-reconcile.service';

/**
 * The offer mirror had no safety net, and it is the one channel where the
 * per-change push cannot be retried by anything else.
 *
 * Creating or repricing an offer enqueues `UPDATE_PRICING` for its material,
 * and that job carries the discount onto Odoo's price sheet. But the existing
 * catalogue sweep only re-pushes materials whose OWN `odooSyncStatus` is not
 * SYNCED — and an offer change never touches that status. So a perfectly
 * synced material, with an offer whose push was lost because the backend was
 * restarting or the queue was flushed, was never revisited: the discount lived
 * in the backend and simply never appeared in Odoo, with nothing on either
 * screen to say so.
 */
describe('OfferMirrorReconcileService', () => {
  let service: OfferMirrorReconcileService;
  let odooSync: any;
  let offerRepo: any;
  let productRepo: any;
  let offerRows: { productId: string }[];
  let mirrored: Set<string>;

  beforeEach(() => {
    offerRows = [{ productId: 'p1' }, { productId: 'p2' }];
    mirrored = new Set(['p1', 'p2']);

    odooSync = { enqueueUpdatePricing: jest.fn().mockResolvedValue(undefined) };
    offerRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(async () => offerRows),
      })),
    };
    productRepo = {
      // HONOURS the `odooProductId: Not(IsNull())` it is given: a material that
      // was never mirrored has no price sheet for an offer to land on, and a
      // mock that ignored the filter would hide the fact that the code checks.
      findOne: jest.fn(async ({ where }: any) =>
        mirrored.has(where.id) ? { id: where.id, odooProductId: 42 } : null,
      ),
    };

    service = new OfferMirrorReconcileService(odooSync, offerRepo, productRepo);
  });

  it('re-pushes every material that carries an offer', async () => {
    await service.onModuleInit();

    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledTimes(2);
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p2' });
  });

  it('pushes ONCE per material, not once per offer row', async () => {
    // A graded material may hold an offer per grade, and they all travel in
    // the same price list — pushing per row would send the same list twice.
    offerRows = [{ productId: 'p1' }];
    await service.onModuleInit();
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledTimes(1);
  });

  it('skips a material Odoo has never seen', async () => {
    // There is no price sheet for the offer to land on, so the job would fail
    // on every run for as long as the offer exists.
    mirrored.delete('p2');
    await service.onModuleInit();

    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledTimes(1);
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
  });

  it('runs on the cron as well as at startup', async () => {
    // Startup alone only covers a restart. The gap this closes — a push lost
    // while the queue was down — can happen at any time.
    await service.scheduledReconcile();
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledTimes(2);
  });

  it('never lets a queue failure crash boot or kill the cron', async () => {
    // The next tick retries anyway, which is the whole point of a loop.
    odooSync.enqueueUpdatePricing.mockRejectedValue(new Error('queue down'));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
