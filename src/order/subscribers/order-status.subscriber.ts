import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  UpdateEvent,
} from 'typeorm';
import { Order } from '../entities/order.entity';

/** Fired once, right after an order's status actually changes. */
export const ORDER_STATUS_CHANGED = 'order.status.changed';

export interface OrderStatusChangedEvent {
  buyerAccountId: string;
  orderNumber: string;
  status: string;
  previousStatus: string;
}

/**
 * Notifies the buyer on EVERY order status change — without threading a
 * notification call through the dozen services that move an order (checkout,
 * allocation, split decision, delivery, receipt, the Odoo sync). Each of those
 * ends in `orderRepo.save(order)`, so a single database subscriber sees them
 * all and is the one place that can promise "the buyer always hears about it".
 *
 * The subscriber itself does no work beyond EMITTING an event: it runs inside
 * the order's own write, so it must not do I/O there. The listener
 * (OrderStatusNotifier) creates and sends the notification off the write path.
 */
@Injectable()
export class OrderStatusSubscriber implements EntitySubscriberInterface<Order> {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {
    // Register with the connection so TypeORM calls our hooks.
    dataSource.subscribers.push(this);
  }

  listenTo(): typeof Order {
    return Order;
  }

  afterUpdate(event: UpdateEvent<Order>): void {
    const after = event.entity as Partial<Order> | undefined;
    const before = event.databaseEntity as Order | undefined;
    if (!after || !before) return;

    const status = after.status;
    if (!status || status === before.status) return; // not a status change

    const buyerAccountId = after.buyerAccountId ?? before.buyerAccountId;
    if (!buyerAccountId) return; // nobody to tell (e.g. an admin-created order)

    this.events.emit(ORDER_STATUS_CHANGED, {
      buyerAccountId,
      orderNumber: after.orderNumber ?? before.orderNumber ?? '',
      status,
      previousStatus: before.status,
    } as OrderStatusChangedEvent);
  }
}
