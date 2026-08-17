import { PricingService } from './pricing.service';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';
import { PricingArchiveReason } from '@src/waste-management/enums/pricing-archive-reason.enum';

/**
 * The expiry sweep: rows whose admin-set `effectiveUntil` has passed are moved
 * OUT of the live table into history (reason EXPIRED) and every admin is
 * notified that the material has fallen out of the catalogues.
 */
describe('PricingService.sweepExpiredPricing', () => {
  const expiredRows = [
    { id: 'pp1', productId: 'p1', tier: PricingTier.INDIVIDUAL, conditionCode: null, conditionId: null, price: '0.30', currency: 'JOD', effectiveFrom: new Date(Date.now() - 10000), effectiveUntil: new Date(Date.now() - 1000) },
    { id: 'pp2', productId: 'p1', tier: PricingTier.FACTORY, conditionCode: 'GOOD', conditionId: 'c-good', price: '0.25', currency: 'JOD', effectiveFrom: new Date(Date.now() - 10000), effectiveUntil: new Date(Date.now() - 1000) },
  ];

  const build = () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(expiredRows),
    };
    const pricingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const historyRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    const productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1', name: 'PET bottles' }) };
    const odooSync = { enqueueUpdatePricing: jest.fn().mockResolvedValue(undefined) };
    const cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    const offerSettlement = { resettle: jest.fn().mockResolvedValue({ repriced: 0, suspended: 0 }) };
    const accountRepo = { find: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]) };
    const notifications = {
      createNotification: jest.fn(async () => ({ id: 'n1' })),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PricingService(
      productRepo as any,
      pricingRepo as any,
      historyRepo as any,
      {} as any, // cartItemRepo
      odooSync as any,
      { record: jest.fn() } as any,
      cache as any,
      {} as any, // conditions
      {} as any, // productConditions
      offerSettlement as any,
      accountRepo as any,
      notifications as any,
      { defaultCurrency: jest.fn().mockResolvedValue('SYP') } as any,
    );
    return { service, pricingRepo, historyRepo, productRepo, odooSync, cache, offerSettlement, accountRepo, notifications };
  };

  it('archives expired rows to history and removes them from the live table', async () => {
    const t = build();
    const result = await t.service.sweepExpiredPricing();

    expect(result).toEqual({ products: 1, rows: 2 });
    // Both rows archived with reason EXPIRED.
    const archived = t.historyRepo.create.mock.calls.map((c) => c[0]);
    expect(archived).toHaveLength(2);
    expect(archived.every((r) => r.archivedReason === PricingArchiveReason.EXPIRED)).toBe(true);
    // And removed from the live table.
    expect(t.pricingRepo.remove).toHaveBeenCalledWith(expiredRows);
    // Offers re-settled and Odoo told the prices are gone.
    expect(t.offerSettlement.resettle).toHaveBeenCalledWith('p1', 'system');
    expect(t.odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'p1' });
  });

  it('notifies every admin that the material dropped out of the catalogues', async () => {
    const t = build();
    await t.service.sweepExpiredPricing();

    // One notification per admin (2 admins), enqueued for delivery.
    expect(t.notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(t.notifications.enqueueNotification).toHaveBeenCalledTimes(2);
    const payload: any = (t.notifications.createNotification.mock.calls[0] as any[])[0];
    expect(payload.userId).toBe('admin-1');
    expect(payload.args).toEqual({ name: 'PET bottles' });
  });

  it('does nothing when no row has expired', async () => {
    const t = build();
    (t.pricingRepo.createQueryBuilder() as any).getMany.mockResolvedValueOnce([]);
    const result = await t.service.sweepExpiredPricing();
    expect(result).toEqual({ products: 0, rows: 0 });
    expect(t.pricingRepo.remove).not.toHaveBeenCalled();
    expect(t.notifications.createNotification).not.toHaveBeenCalled();
  });
});
