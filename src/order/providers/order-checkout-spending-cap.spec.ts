import { BadRequestException } from '@nestjs/common';
import { OrderCheckoutService } from './order-checkout.service';
import { Role } from '@src/user/enums/role.enum';
import { SpendingCapPeriod } from '../enums/spending-cap-period.enum';

/**
 * Proves the ceiling is actually enforced at checkout: a passing minimum plus a
 * failing spending cap must refuse the order BEFORE any order row is created.
 */
describe('OrderCheckoutService — spending cap enforcement', () => {
  const build = (capPassed: boolean) => {
    const orderRepo = { save: jest.fn(), create: jest.fn(), findOne: jest.fn() };
    const cartRepo = { findOne: jest.fn().mockResolvedValue({ id: 'cart1' }) };
    const cartItemRepo = {
      find: jest.fn().mockResolvedValue([{ subtotal: '500', productId: 'p1', quantity: '5', unitType: 'KG' }]),
      delete: jest.fn(),
    };
    const minimums = { check: jest.fn().mockResolvedValue({ passed: true, currency: 'JOD' }) };
    const spendingCaps = {
      check: jest.fn().mockResolvedValue({
        passed: capPassed,
        period: SpendingCapPeriod.MONTHLY,
        alreadySpent: 800,
        cap: 1000,
        incoming: 500,
        remaining: 200,
        currency: 'JOD',
      }),
    };
    const allocation = { allocate: jest.fn().mockResolvedValue({ result: 'FULL' }) };

    const svc = new OrderCheckoutService(
      orderRepo as any, {} as any, {} as any, cartRepo as any, cartItemRepo as any,
      {} as any, {} as any, minimums as any, spendingCaps as any, allocation as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, orderRepo, spendingCaps, allocation };
  };

  const input = {
    accountId: 'acc1',
    role: Role.FACTORY,
    profileId: 'prof1',
    provinceId: 'prov1',
  };

  it('refuses checkout when the spending cap is exceeded — no order created', async () => {
    const { svc, orderRepo, allocation } = build(false);
    await expect(svc.checkout(input as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(orderRepo.save).not.toHaveBeenCalled();
    expect(allocation.allocate).not.toHaveBeenCalled();
  });

  it('checks the cap with the live goods total and the buyer account', async () => {
    const { svc, spendingCaps } = build(false);
    await svc.checkout(input as any).catch(() => undefined);
    expect(spendingCaps.check).toHaveBeenCalledWith(Role.FACTORY, 'acc1', 500);
  });
});
