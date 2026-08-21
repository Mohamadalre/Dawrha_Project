import { NotFoundException } from '@nestjs/common';
import { OrderSpendingCapService } from './order-spending-cap.service';
import { SpendingCapPeriod } from '../enums/spending-cap-period.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * The check() logic is the part that gates money, so it carries the tests:
 * no cap passes, spend within the ceiling passes, spend over it fails, and the
 * running total is what the query returns (cancelled orders already excluded by
 * the WHERE clause, asserted below).
 */
describe('OrderSpendingCapService', () => {
  let service: OrderSpendingCapService;
  let capRepo: any;
  let orderRepo: any;
  let qb: any;

  const cap = (over: any = {}) => ({
    role: Role.FACTORY,
    maxAmount: '1000',
    period: SpendingCapPeriod.MONTHLY,
    currency: 'JOD',
    isActive: true,
    ...over,
  });

  beforeEach(() => {
    qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ spent: '0' }),
    };
    capRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn() };
    orderRepo = { createQueryBuilder: jest.fn(() => qb) };
    service = new OrderSpendingCapService(capRepo, orderRepo, { defaultCurrency: jest.fn().mockResolvedValue('SYP') } as any);
  });

  it('passes with no configured cap (null = no ceiling)', async () => {
    capRepo.findOne.mockResolvedValue(null);
    const res = await service.check(Role.FACTORY, 'acc1', 500);
    expect(res.passed).toBe(true);
    expect(res.cap).toBeNull();
    // No query is even run when there is no cap.
    expect(orderRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('passes when spend so far plus this order stays within the ceiling', async () => {
    capRepo.findOne.mockResolvedValue(cap({ maxAmount: '1000' }));
    qb.getRawOne.mockResolvedValue({ spent: '600' });

    const res = await service.check(Role.FACTORY, 'acc1', 300); // 900 ≤ 1000
    expect(res.passed).toBe(true);
    expect(res.alreadySpent).toBe(600);
    expect(res.remaining).toBe(100);
  });

  it('fails when this order would push spend over the ceiling', async () => {
    capRepo.findOne.mockResolvedValue(cap({ maxAmount: '1000' }));
    qb.getRawOne.mockResolvedValue({ spent: '800' });

    const res = await service.check(Role.FACTORY, 'acc1', 300); // 1100 > 1000
    expect(res.passed).toBe(false);
    expect(res.remaining).toBe(200); // 1000 - 800 already spent
  });

  it('excludes cancelled orders from the running total', async () => {
    capRepo.findOne.mockResolvedValue(cap());
    await service.check(Role.FACTORY, 'acc1', 10);
    // The status filter is what keeps a cancelled order from counting as spend.
    const clauses = qb.andWhere.mock.calls.map((c: any[]) => c[0]).join(' ');
    expect(clauses).toContain('o.status != :cancelled');
  });

  it('upsert creates a row when none exists', async () => {
    capRepo.findOne.mockResolvedValue(null);
    capRepo.create.mockReturnValue({ role: Role.FACTORY });
    capRepo.save.mockImplementation((r: any) => Promise.resolve(r));

    const row = await service.upsert(
      Role.FACTORY,
      { maxAmount: 500, period: SpendingCapPeriod.DAILY, isActive: true },
      'admin1',
    );
    expect(row.maxAmount).toBe('500');
    expect(row.period).toBe(SpendingCapPeriod.DAILY);
    expect(row.updatedBy).toBe('admin1');
  });

  it('remove throws when there is nothing to remove', async () => {
    capRepo.findOne.mockResolvedValue(null);
    await expect(service.remove(Role.CITIZEN)).rejects.toBeInstanceOf(NotFoundException);
  });
});
