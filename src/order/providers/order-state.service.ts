import { ConflictException, Injectable } from '@nestjs/common';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { Order } from '../entities/order.entity';
import { OrderPart } from '../entities/order-part.entity';
import {
  ORDER_TRANSITIONS,
  OrderStatus,
  canTransition,
} from '../enums/order-status.enum';
import {
  OrderPartStatus,
  canTransitionPart,
} from '../enums/order-part-status.enum';
import { deriveOrderStatus } from '../derive-order-status';

const LOG_META = { context: 'ORDER_STATE', channel: 'orders' } as const;

/**
 * The only place an order or a part changes status.
 *
 * Routing every move through one guard means an illegal transition is caught
 * where it happens rather than surfacing later as a nonsensical state — an
 * order that is somehow both cancelled and preparing, say. The legal moves
 * themselves live in the transition maps, so this file holds no lifecycle
 * knowledge of its own and never needs editing when a state is added.
 */
@Injectable()
export class OrderStateService {
  /**
   * Moves the order, or refuses with a message that names both states.
   *
   * 409 rather than 400: the request was well-formed, the order simply is not
   * where the caller believed. That is exactly what happens when a buyer taps
   * "cancel" at the instant the last manager approves — and the loser of that
   * race deserves to be told which it was.
   */
  assertOrderTransition(order: Order, to: OrderStatus): void {
    if (order.status === to) return;
    if (!canTransition(order.status, to)) {
      throw new ConflictException(
        `Order ${order.orderNumber} cannot move from ${order.status} to ${to}`,
      );
    }
  }

  applyOrderStatus(order: Order, to: OrderStatus, at = new Date()): Order {
    this.assertOrderTransition(order, to);
    if (order.status === to) return order;

    const from = order.status;
    order.status = to;
    this.stampOrder(order, to, at);
    winstonLogger.info(
      `Order ${order.orderNumber}: ${from} -> ${to}`,
      LOG_META,
    );
    return order;
  }

  assertPartTransition(part: OrderPart, to: OrderPartStatus): void {
    if (part.status === to) return;
    if (!canTransitionPart(part.status, to)) {
      throw new ConflictException(
        `Order part ${part.id} cannot move from ${part.status} to ${to}`,
      );
    }
  }

  applyPartStatus(
    part: OrderPart,
    to: OrderPartStatus,
    at = new Date(),
  ): OrderPart {
    this.assertPartTransition(part, to);
    if (part.status === to) return part;
    part.status = to;
    this.stampPart(part, to, at);
    return part;
  }

  /**
   * The status the parent order should now hold, derived from its parts.
   * Delegates to the pure helper so the Odoo event handler can derive the same
   * answer without depending on this service (and creating a module cycle).
   */
  deriveOrderStatus(order: Order, parts: OrderPart[]): OrderStatus | null {
    return deriveOrderStatus(order.fulfilmentMode, parts);
  }

  /** Timestamps are part of the transition, not an afterthought at call sites. */
  private stampOrder(order: Order, to: OrderStatus, at: Date): void {
    const stamps: Partial<Record<OrderStatus, () => void>> = {
      [OrderStatus.PREPARING]: () => (order.preparingAt = at),
      [OrderStatus.DELIVERED]: () => (order.deliveredAt = at),
      [OrderStatus.COMPLETED]: () => (order.completedAt = at),
      [OrderStatus.CANCELLED]: () => (order.cancelledAt = at),
    };
    stamps[to]?.();
  }

  private stampPart(part: OrderPart, to: OrderPartStatus, at: Date): void {
    const stamps: Partial<Record<OrderPartStatus, () => void>> = {
      [OrderPartStatus.STOCK_DEDUCTED]: () => (part.stockDeductedAt = at),
      [OrderPartStatus.IN_OUTPUT_ZONE]: () => (part.finishedAt = at),
      [OrderPartStatus.DISPATCHED]: () => (part.dispatchedAt = at),
      [OrderPartStatus.DELIVERED]: () => (part.deliveredAt = at),
    };
    stamps[to]?.();
  }

  /** Everything an order may legally do next — handy for the buyer's UI. */
  nextStatuses(order: Order): readonly OrderStatus[] {
    return ORDER_TRANSITIONS[order.status];
  }
}
