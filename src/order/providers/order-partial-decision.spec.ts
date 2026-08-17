import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrderCheckoutService } from './order-checkout.service';
import { OrderStatus } from '../enums/order-status.enum';

/**
 * The buyer's answer when an order cannot be covered in full.
 *
 * The order parks at NEEDS_CUSTOMER_DECISION with a frozen snapshot of the
 * request. Accepting re-plans against current stock on the covered part;
 * declining cancels. Both are guarded so a double-tap or a raced cancel resolves
 * to exactly one outcome.
 */
describe('OrderCheckoutService — partial-fulfilment decision', () => {
  const SNAPSHOT = [
    {
      productId: 'p1',
      odooProductId: 10,
      productName: 'PET',
      conditionCode: null,
      quantity: 100,
      unitType: 'KG',
      unitPrice: 2,
    },
  ];

  const build = (order: any) => {
    const saved: any[] = [];
    const orderRepo = {
      createQueryBuilder: () => ({
        setLock: () => ({
          where: () => ({ getOne: async () => order }),
        }),
      }),
      save: jest.fn(async (o: any) => {
        saved.push({ ...o });
        return o;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({ getRepository: () => orderRepo }),
      ),
    };
    const allocation = {
      allocate: jest.fn().mockResolvedValue({ result: 'ALLOCATED', parts: 1 }),
    };

    const svc = new OrderCheckoutService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, allocation as any,
      {} as any, {} as any, {} as any, dataSource as any,
    );
    return { svc, orderRepo, allocation, saved };
  };

  const pending = () => ({
    id: 'ord1',
    buyerAccountId: 'acc1',
    status: OrderStatus.NEEDS_CUSTOMER_DECISION,
    requestedLines: SNAPSHOT,
  });

  it('accepting re-plans against current stock, forcing the partial', async () => {
    const { svc, allocation } = build(pending());

    const res: any = await svc.respondToPartial('acc1', 'ord1', true);

    expect(allocation.allocate).toHaveBeenCalledWith('ord1', SNAPSHOT, {
      forcePartial: true,
    });
    expect(res.allocation.result).toBe('ALLOCATED');
  });

  it('accepting moves the order out of NEEDS_CUSTOMER_DECISION under the lock', async () => {
    const order = pending();
    const { svc, saved } = build(order);

    await svc.respondToPartial('acc1', 'ord1', true);

    // Handed back to allocation via PENDING_ALLOCATION.
    expect(saved[0].status).toBe(OrderStatus.PENDING_ALLOCATION);
  });

  it('declining cancels the order and never calls allocation', async () => {
    const { svc, allocation, saved } = build(pending());

    const res: any = await svc.respondToPartial('acc1', 'ord1', false);

    expect(res.cancelled).toBe(true);
    expect(saved[0].status).toBe(OrderStatus.CANCELLED);
    expect(saved[0].requestedLines).toBeNull();
    expect(allocation.allocate).not.toHaveBeenCalled();
  });

  it('refuses when the order is no longer awaiting a decision', async () => {
    const order = { ...pending(), status: OrderStatus.PREPARING };
    const { svc, allocation } = build(order);

    await expect(svc.respondToPartial('acc1', 'ord1', true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(allocation.allocate).not.toHaveBeenCalled();
  });

  it('refuses an order that belongs to someone else', async () => {
    const { svc } = build(pending());
    await expect(
      svc.respondToPartial('someone-else', 'ord1', true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to accept when the snapshot is somehow empty', async () => {
    const order = { ...pending(), requestedLines: [] };
    const { svc, allocation } = build(order);

    await expect(svc.respondToPartial('acc1', 'ord1', true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(allocation.allocate).not.toHaveBeenCalled();
  });
});

/**
 * The buyer's acknowledgement that a SPLIT order was refused by the
 * administrator. There is nothing to re-try, so confirming simply closes it.
 */
describe('OrderCheckoutService — confirm split rejection', () => {
  const build = (order: any) => {
    const saved: any[] = [];
    const orderRepo = {
      createQueryBuilder: () => ({
        setLock: () => ({ where: () => ({ getOne: async () => order }) }),
      }),
      save: jest.fn(async (o: any) => {
        saved.push({ ...o });
        return o;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({ getRepository: () => orderRepo }),
      ),
    };
    const svc = new OrderCheckoutService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, dataSource as any,
    );
    return { svc, saved };
  };

  const rejected = () => ({
    id: 'ord1',
    buyerAccountId: 'acc1',
    status: OrderStatus.REJECTED_AWAITING_BUYER,
  });

  it('closes the order when the buyer confirms', async () => {
    const { svc, saved } = build(rejected());
    const res: any = await svc.confirmRejection('acc1', 'ord1');
    expect(res.cancelled).toBe(true);
    expect(saved[0].status).toBe(OrderStatus.CANCELLED);
    expect(saved[0].cancelledAt).toBeInstanceOf(Date);
  });

  it('refuses when the order is not awaiting a rejection confirmation', async () => {
    const { svc } = build({ ...rejected(), status: OrderStatus.PREPARING });
    await expect(svc.confirmRejection('acc1', 'ord1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses an order that belongs to someone else', async () => {
    const { svc } = build(rejected());
    await expect(
      svc.confirmRejection('someone-else', 'ord1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
