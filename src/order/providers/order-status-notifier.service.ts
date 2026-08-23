import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { ORDER_STATUS_CHANGED } from '../subscribers/order-status.subscriber';
import type { OrderStatusChangedEvent } from '../subscribers/order-status.subscriber';

const LOG_META = { context: 'ORDER_NOTIFY', channel: 'orders' } as const;

/**
 * Turns an order status change into a notification for the buyer — the in-app
 * record plus a queued push. Runs on the event the subscriber emits, so it is
 * OFF the order's write path: a notification hiccup can never fail (or roll
 * back) the status change that triggered it.
 *
 * The stored title/body are the English fallback; the i18n keys let each of the
 * buyer's devices be served the push in its own language at send time.
 */
@Injectable()
export class OrderStatusNotifier {
  constructor(private readonly notifications: NotificationService) {}

  @OnEvent(ORDER_STATUS_CHANGED)
  async onOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    try {
      const notification = await this.notifications.createNotification({
        userId: event.buyerAccountId,
        type: NotificationType.ORDER,
        title: 'Order status updated',
        body: `Order ${event.orderNumber} is now ${event.status}.`,
        titleKey: 'notifications.orderStatusChanged.title',
        bodyKey: 'notifications.orderStatusChanged.body',
        args: { order: event.orderNumber, status: event.status },
      });
      await this.notifications.enqueueNotification(notification.id);
    } catch (err) {
      winstonLogger.warn(
        `Order status notification not sent for ${event.orderNumber}: ${
          (err as Error).message
        }`,
        LOG_META,
      );
    }
  }
}
