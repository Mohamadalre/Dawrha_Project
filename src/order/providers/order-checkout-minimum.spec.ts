import { BadRequestException } from '@nestjs/common';
import { OrderCheckoutService } from './order-checkout.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * Proves the FLOOR is enforced at checkout, per role: a goods total below the
 * role's minimum is refused BEFORE any order is created; at/above it, checkout
 * proceeds. The spending cap is stubbed to always pass so only the minimum is
 * under test.
 */
describe('OrderCheckoutService — minimum-order enforcement', () => {
  const build = (opts: { subtotal: string; minPassed: boolean }) => {
    const orderRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (o) => ({ ...o, id: 'o1' })),
      findOne: jest.fn(async () => ({ id: 'o1', status: 'PENDING_ALLOCATION' })),
      count: jest.fn(async () => 0),
    };
    const cartRepo = { findOne: jest.fn().mockResolvedValue({ id: 'cart1' }) };
    const cartItemRepo = {
      find: jest.fn().mockResolvedValue([
        { subtotal: opts.subtotal, productId: 'p1', quantity: '5', unitType: 'KG' },
      ]),
      delete: jest.fn(),
    };
    const minimums = {
      check: jest.fn().mockResolvedValue({
        passed: opts.minPassed,
        required: 50,
        shortfall: opts.minPassed ? 0 : 20,
        currency: 'JOD',
      }),
    };
    const spendingCaps = { check: jest.fn().mockResolvedValue({ passed: true, currency: 'JOD' }) };
    const allocation = { allocate: jest.fn().mockResolvedValue({ result: 'FULL' }) };
    // Only needed once checkout gets PAST the guards (the happy path).
    const productRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'p1', odooProductId: 'odoo1', name: 'Paper' }]),
    };
    const sellability = { assertSellable: jest.fn().mockResolvedValue(undefined) };
    const effectivePrice = { effectivePrice: jest.fn().mockResolvedValue({ price: 16 }) };

    const svc = new OrderCheckoutService(
      orderRepo as any, {} as any, {} as any, cartRepo as any, cartItemRepo as any,
      productRepo as any, {} as any, minimums as any, spendingCaps as any, allocation as any,
      {} as any, sellability as any, effectivePrice as any, {} as any,
    );
    return { svc, orderRepo, minimums, allocation };
  };

  const input = (role: Role) => ({
    accountId: 'acc1',
    role,
    profileId: 'prof1',
    provinceId: 'prov1',
  });

  it.each([Role.FACTORY, Role.EXTERNAL_PARTNER])(
    'refuses %s checkout below the minimum — no order created',
    async (role) => {
      const { svc, orderRepo, allocation } = build({ subtotal: '30', minPassed: false });
      await expect(svc.checkout(input(role) as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(allocation.allocate).not.toHaveBeenCalled();
    },
  );

  it('checks the minimum with the live goods total', async () => {
    const { svc, minimums } = build({ subtotal: '30', minPassed: false });
    await svc.checkout(input(Role.FACTORY) as any).catch(() => undefined);
    expect(minimums.check).toHaveBeenCalledWith(Role.FACTORY, 30);
  });

  it('proceeds when the goods total meets the minimum', async () => {
    const { svc, orderRepo, allocation } = build({ subtotal: '80', minPassed: true });
    const res = await svc.checkout(input(Role.FACTORY) as any);
    expect(orderRepo.save).toHaveBeenCalled();
    expect(allocation.allocate).toHaveBeenCalled();
    expect(res.order_id).toBe('o1');
  });
});
