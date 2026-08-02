import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeliveryRateService } from './delivery-rate.service';

/**
 * The number every delivery quote is built from.
 *
 * Two rules carry the design, and both are about the past rather than the
 * present:
 *
 *  - a new rate CLOSES the old one instead of overwriting it. A delivery quoted
 *    last month was quoted at last month's rate, and rewriting the number in
 *    place would make every past quote unexplainable to the buyer who paid it;
 *  - exactly ONE rate is in force. Two would make a quote depend on which row a
 *    query happened to return first — prices simply wrong some of the time,
 *    with nothing to notice.
 */
describe('DeliveryRateService', () => {
  let repo: any;
  let manager: any;
  let dataSource: any;
  let service: DeliveryRateService;
  let saved: any[];

  const ADMIN = 'admin-uuid';

  const rate = (over: any = {}) => ({
    id: 'r1',
    ratePerKm: '0.500',
    baseFee: '2.000',
    minCharge: '3.000',
    currency: 'JOD',
    isActive: true,
    effectiveFrom: new Date('2026-01-01'),
    effectiveUntil: null,
    note: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  });

  beforeEach(() => {
    saved = [];
    repo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (r) => { saved.push(r); return { id: 'new', ...r }; }),
      create: jest.fn((v) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    manager = { getRepository: jest.fn(() => repo) };
    dataSource = { transaction: jest.fn(async (cb) => cb(manager)) };
    service = new DeliveryRateService(repo, dataSource);
  });

  // ------------------------------------------------------------------
  // Setting a rate
  // ------------------------------------------------------------------
  it('closes the previous rate instead of editing it', async () => {
    await service.set({ rate_per_km: 0.75 }, ADMIN);

    // The old row is deactivated and stamped with an end date — it is what
    // deliveries were actually quoted at, so it has to survive.
    expect(repo.update).toHaveBeenCalledWith(
      { isActive: true },
      expect.objectContaining({ isActive: false, effectiveUntil: expect.any(Date) }),
    );
    expect(saved[0]).toMatchObject({ ratePerKm: '0.75', isActive: true });
  });

  it('closes and opens inside ONE transaction', async () => {
    await service.set({ rate_per_km: 1 }, ADMIN);

    // Two active rates would make every quote depend on which row came back
    // first, so the two halves must not be separable.
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses a rate of zero', async () => {
    // Zero is a price, and it says every delivery is free.
    await expect(service.set({ rate_per_km: 0 }, ADMIN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a negative base fee or minimum charge', async () => {
    await expect(
      service.set({ rate_per_km: 1, base_fee: -1 }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.set({ rate_per_km: 1, min_charge: -5 }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records who set it and when', async () => {
    await service.set({ rate_per_km: 0.4, note: 'Fuel increase' }, ADMIN);

    expect(saved[0]).toMatchObject({
      createdBy: ADMIN,
      note: 'Fuel increase',
      effectiveFrom: expect.any(Date),
    });
  });

  // ------------------------------------------------------------------
  // Correcting the current rate
  // ------------------------------------------------------------------
  it('corrects the rate in force', async () => {
    repo.findOne.mockResolvedValue(rate());

    const res: any = await service.update('r1', { rate_per_km: 0.9 }, ADMIN);

    expect(res.result.rate_per_km).toBe(0.9);
    // Untouched fields keep their value — a correction is not a reset.
    expect(res.result.base_fee).toBe(2);
  });

  it('refuses to rewrite a SUPERSEDED rate', async () => {
    repo.findOne.mockResolvedValue(rate({ isActive: false }));

    // That row is what past deliveries were quoted at. Editing it would change
    // history, not a setting.
    await expect(
      service.update('r1', { rate_per_km: 9 }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a missing rate as not found', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(
      service.update('nope', { rate_per_km: 1 }, ADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ------------------------------------------------------------------
  // Quoting
  // ------------------------------------------------------------------
  it('quotes base fee plus distance times the rate', async () => {
    repo.findOne.mockResolvedValue(rate({ minCharge: '0' }));

    const q = await service.quote(10);

    expect(q.cost).toBe(7); // 2 + 10 × 0.5
    expect(q.distance_km).toBe(10);
  });

  it('applies the minimum charge to a very short trip', async () => {
    repo.findOne.mockResolvedValue(rate());   // min 3, base 2, 0.5/km

    const q = await service.quote(1);

    // 2 + 0.5 = 2.5, below the floor. A short trip still costs a driver, a
    // vehicle and an hour.
    expect(q.cost).toBe(3);
  });

  it('treats a negative distance as zero rather than a discount', async () => {
    repo.findOne.mockResolvedValue(rate({ minCharge: '0' }));

    const q = await service.quote(-50);

    expect(q.cost).toBe(2);
  });

  it('refuses to quote before any rate has been set', async () => {
    repo.findOne.mockResolvedValue(null);

    // Silently quoting zero would deliver for free until somebody noticed.
    await expect(service.quote(10)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says plainly when no rate is configured yet', async () => {
    repo.findOne.mockResolvedValue(null);

    const view: any = await service.view();

    // A client rendering `current` without checking would show an empty box
    // that reads like a zero rate.
    expect(view.is_configured).toBe(false);
    expect(view.current).toBeNull();
  });
});
