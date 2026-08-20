import { OrderViewService } from '@src/order/providers/order-view.service';
import { PointsWalletService } from './points-wallet.service';
import { PointsRateService } from './points-rate.service';
import { OrderStatus } from '@src/order/enums/order-status.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * The whole points-award scenario, end to end through the REAL services (only
 * the repositories and the notification transport are stubbed):
 *
 *   admin sets 1 point = 1000  →  buyer receives a 3000 order  →  confirm
 *   receipt  →  +3 points credited, the buyer is told, and the response says so.
 */
describe('Points award on order receipt (scenario)', () => {
  const wire = (opts: { rate?: string | null; startingPoints: number }) => {
    const notifications = { createNotification: jest.fn().mockResolvedValue({}) };
    const rateRepo = {
      findOne: jest.fn().mockResolvedValue(opts.rate ? { amountPerPoint: opts.rate } : null),
    };
    const walletStore = { points: opts.startingPoints };
    const walletRepo = {
      findOne: jest.fn().mockResolvedValue(walletStore),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (w: any) => w),
    };
    const settings = { defaultCurrency: jest.fn().mockResolvedValue('SYP') };
    const rates = new PointsRateService(rateRepo as any, settings as any);
    const stageRepo = { find: jest.fn().mockResolvedValue([]) };
    const wallet = new PointsWalletService(
      walletRepo as any, rates, notifications as any, stageRepo as any,
      { previousRanks: jest.fn().mockResolvedValue(new Map()), refreshBaseline: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const order: any = {
      id: 'ord1',
      orderNumber: 'ORD-1',
      buyerAccountId: 'acc1',
      buyerRole: Role.FACTORY,
      status: OrderStatus.DELIVERED,
      grandTotal: '3000',
      currency: 'SYP',
    };
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn(async (o: any) => o),
    };
    const view = new OrderViewService(
      orderRepo as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, wallet,
      { gradeMapFor: async () => new Map() } as any,
    );
    return { view, order, orderRepo, walletRepo, notifications };
  };

  it('credits 3 points for a 3000 order at 1000-per-point, and notifies', async () => {
    const { view, order, walletRepo, notifications } = wire({ rate: '1000', startingPoints: 5 });

    const res: any = await view.confirmReceipt('acc1', 'ord1');

    // The order is completed AND the points are awarded.
    expect(order.status).toBe(OrderStatus.COMPLETED);
    expect(res.points_awarded).toBe(3);
    expect(res.points_balance).toBe(8);
    expect(walletRepo.save).toHaveBeenCalledWith(expect.objectContaining({ points: 8 }));
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'acc1',
        args: expect.objectContaining({ points: 3, order: 'ORD-1' }),
      }),
    );
  });

  it('completes the receipt but awards nothing when the admin set no rate', async () => {
    const { view, order, walletRepo } = wire({ rate: null, startingPoints: 5 });

    const res: any = await view.confirmReceipt('acc1', 'ord1');

    expect(order.status).toBe(OrderStatus.COMPLETED); // receipt still succeeds
    expect(res.points_awarded).toBe(0);
    expect(res.points_balance).toBeNull();
    expect(walletRepo.save).not.toHaveBeenCalled();
  });
});
