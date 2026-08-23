import { EventEmitter2 } from '@nestjs/event-emitter';
import { UpdateEvent } from 'typeorm';
import {
  OrderStatusSubscriber,
  ORDER_STATUS_CHANGED,
  OrderStatusChangedEvent,
} from './order-status.subscriber';
import { Order } from '../entities/order.entity';

describe('OrderStatusSubscriber', () => {
  let emit: jest.Mock;
  let subscribers: unknown[];
  let subscriber: OrderStatusSubscriber;

  beforeEach(() => {
    emit = jest.fn();
    subscribers = [];
    // The subscriber registers itself with the connection in its constructor.
    subscriber = new OrderStatusSubscriber(
      { subscribers } as any,
      { emit } as unknown as EventEmitter2,
    );
  });

  const evt = (
    entity: Partial<Order> | undefined,
    databaseEntity: Partial<Order> | undefined,
  ): UpdateEvent<Order> =>
    ({ entity, databaseEntity } as unknown as UpdateEvent<Order>);

  it('registers itself with the datasource so TypeORM calls its hooks', () => {
    expect(subscribers).toContain(subscriber);
  });

  it('listens only to Order', () => {
    expect(subscriber.listenTo()).toBe(Order);
  });

  it('emits when the status actually changes', () => {
    subscriber.afterUpdate(
      evt(
        { status: 'PREPARING', buyerAccountId: 'buyer-1', orderNumber: 'ORD-9' } as any,
        { status: 'ACCEPTED', buyerAccountId: 'buyer-1', orderNumber: 'ORD-9' } as any,
      ),
    );

    expect(emit).toHaveBeenCalledTimes(1);
    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe(ORDER_STATUS_CHANGED);
    expect(payload).toMatchObject<OrderStatusChangedEvent>({
      buyerAccountId: 'buyer-1',
      orderNumber: 'ORD-9',
      status: 'PREPARING',
      previousStatus: 'ACCEPTED',
    });
  });

  it('does NOT emit when the status is unchanged (a non-status column was saved)', () => {
    subscriber.afterUpdate(
      evt(
        { status: 'ACCEPTED', buyerAccountId: 'buyer-1', orderNumber: 'ORD-9' } as any,
        { status: 'ACCEPTED', buyerAccountId: 'buyer-1', orderNumber: 'ORD-9' } as any,
      ),
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('does NOT emit when there is no buyer to tell (e.g. an admin-created order)', () => {
    subscriber.afterUpdate(
      evt(
        { status: 'PREPARING', buyerAccountId: null, orderNumber: 'ORD-9' } as any,
        { status: 'ACCEPTED', buyerAccountId: null, orderNumber: 'ORD-9' } as any,
      ),
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('does NOT emit for a partial update where TypeORM did not load the entity/db state', () => {
    subscriber.afterUpdate(evt(undefined, { status: 'ACCEPTED' } as any));
    subscriber.afterUpdate(evt({ status: 'PREPARING' } as any, undefined));
    expect(emit).not.toHaveBeenCalled();
  });

  it('falls back to the db-entity buyer/number when the update payload omits them', () => {
    subscriber.afterUpdate(
      evt(
        { status: 'DELIVERED' } as any,
        { status: 'IN_TRANSIT', buyerAccountId: 'buyer-2', orderNumber: 'ORD-42' } as any,
      ),
    );
    expect(emit).toHaveBeenCalledWith(ORDER_STATUS_CHANGED, {
      buyerAccountId: 'buyer-2',
      orderNumber: 'ORD-42',
      status: 'DELIVERED',
      previousStatus: 'IN_TRANSIT',
    });
  });
});
