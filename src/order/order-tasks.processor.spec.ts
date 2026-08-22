import { OrderTasksProcessor } from './order-tasks.processor';
import { ORDER_TASKS } from './order-tasks.constants';

/**
 * The consumer that turns "the last warehouse just finished preparing" into a
 * gathering run — without the Odoo-sync module (which discovered it) ever
 * depending on the order module (which plans it).
 */
describe('OrderTasksProcessor', () => {
  const mk = (planImpl?: any, deliveryImpl?: any) => {
    const trips = {
      planConsolidationForOrder: jest.fn(planImpl ?? (async () => ({ trip_count: 1 }))),
      planForOrder: jest.fn(deliveryImpl ?? (async () => ({ trip_count: 1 }))),
    };
    return { trips, proc: new OrderTasksProcessor(trips as any) };
  };

  it('plans the consolidation for a PLAN_CONSOLIDATION job', async () => {
    const { trips, proc } = mk();
    await proc.process({ name: ORDER_TASKS.PLAN_CONSOLIDATION, data: { orderId: 'ord-1' } } as any);
    expect(trips.planConsolidationForOrder).toHaveBeenCalledWith('ord-1');
  });

  it('plans the DELIVERY (system-run) for a PLAN_DELIVERY job', async () => {
    const { trips, proc } = mk();
    await proc.process({ name: ORDER_TASKS.PLAN_DELIVERY, data: { orderId: 'ord-2' } } as any);
    expect(trips.planForOrder).toHaveBeenCalledWith('ord-2');
    expect(trips.planConsolidationForOrder).not.toHaveBeenCalled();
  });

  it('swallows a race on delivery planning (a live trip already exists)', async () => {
    const { proc } = mk(undefined, async () => {
      throw new Error('This order already has a live delivery trip.');
    });
    await expect(
      proc.process({ name: ORDER_TASKS.PLAN_DELIVERY, data: { orderId: 'ord-2' } } as any),
    ).resolves.toBeUndefined();
  });

  it('ignores an unrelated job', async () => {
    const { trips, proc } = mk();
    await proc.process({ name: 'something-else', data: { orderId: 'ord-1' } } as any);
    expect(trips.planConsolidationForOrder).not.toHaveBeenCalled();
    expect(trips.planForOrder).not.toHaveBeenCalled();
  });

  it('ignores a job with no order id', async () => {
    const { trips, proc } = mk();
    await proc.process({ name: ORDER_TASKS.PLAN_CONSOLIDATION, data: {} } as any);
    expect(trips.planConsolidationForOrder).not.toHaveBeenCalled();
  });

  it('swallows a race (e.g. a trip already exists) instead of throwing', async () => {
    const { proc } = mk(async () => {
      throw new Error('This order already has a live consolidation trip.');
    });
    await expect(
      proc.process({ name: ORDER_TASKS.PLAN_CONSOLIDATION, data: { orderId: 'ord-1' } } as any),
    ).resolves.toBeUndefined();
  });
});
