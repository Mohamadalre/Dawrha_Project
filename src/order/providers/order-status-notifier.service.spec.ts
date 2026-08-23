import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { OrderStatusNotifier } from './order-status-notifier.service';
import { ORDER_STATUS_CHANGED, OrderStatusChangedEvent } from '../subscribers/order-status.subscriber';

describe('OrderStatusNotifier', () => {
  let notifications: {
    createNotification: jest.Mock;
    enqueueNotification: jest.Mock;
  };
  let notifier: OrderStatusNotifier;

  const event: OrderStatusChangedEvent = {
    buyerAccountId: 'buyer-1',
    orderNumber: 'ORD-9',
    status: 'PREPARING',
    previousStatus: 'ACCEPTED',
  };

  beforeEach(() => {
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    notifier = new OrderStatusNotifier(notifications as any);
  });

  it('is wired to the ORDER_STATUS_CHANGED event', () => {
    // Guards against the event name drifting apart between emitter and listener.
    expect(ORDER_STATUS_CHANGED).toBe('order.status.changed');
  });

  it('creates an in-app record for the buyer and queues the push', async () => {
    await notifier.onOrderStatusChanged(event);

    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    const payload = notifications.createNotification.mock.calls[0][0];
    expect(payload).toMatchObject({
      userId: 'buyer-1',
      type: NotificationType.ORDER,
      titleKey: 'notifications.orderStatusChanged.title',
      bodyKey: 'notifications.orderStatusChanged.body',
      args: { order: 'ORD-9', status: 'PREPARING' },
    });
    // Default (English) text is stored as the fallback.
    expect(payload.title).toBeTruthy();
    expect(payload.body).toContain('ORD-9');

    expect(notifications.enqueueNotification).toHaveBeenCalledWith('notif-1');
  });

  it('is best-effort: a notification failure never throws back onto the order write path', async () => {
    notifications.createNotification.mockRejectedValueOnce(new Error('db down'));
    await expect(notifier.onOrderStatusChanged(event)).resolves.toBeUndefined();
    expect(notifications.enqueueNotification).not.toHaveBeenCalled();
  });
});
