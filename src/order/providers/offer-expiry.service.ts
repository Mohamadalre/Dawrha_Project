import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { Order } from '../entities/order.entity';
import { OrderPart } from '../entities/order-part.entity';
import { OrderPartOffer } from '../entities/order-part-offer.entity';
import { OrderOfferStatus } from '../enums/order-offer-status.enum';
import { OrderPartStatus } from '../enums/order-part-status.enum';
import { OrderStatus } from '../enums/order-status.enum';
import { OrderAllocationService } from './order-allocation.service';

const LOG_META = { context: 'OFFER_EXPIRY', channel: 'orders' } as const;

/**
 * Closes out offers nobody answered.
 *
 * The loud failure — a manager pressing "reject" — takes care of itself: the
 * rejection arrives from Odoo and reallocation runs. The quiet one does not. A
 * manager on leave clicks nothing, and without a deadline the buyer's order
 * waits forever with its stock reserved, blocking other orders that could have
 * used it. In practice silence, not refusal, is the more common way an order
 * stalls.
 *
 * An expired offer is treated exactly like a rejection — the warehouse is
 * excluded from the next round — but it is recorded as EXPIRED rather than
 * REJECTED, because "the manager refused" and "nobody looked" are different
 * problems and an admin reviewing a struggling order needs to tell them apart.
 */
@Injectable()
export class OfferExpiryService {
  constructor(
    @InjectRepository(OrderPartOffer)
    private readonly offerRepo: Repository<OrderPartOffer>,
    @InjectRepository(OrderPart)
    private readonly partRepo: Repository<OrderPart>,
    private readonly allocation: OrderAllocationService,
    private readonly odooSync: OdooSyncService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<void> {
    try {
      await this.expireOverdueOffers();
      await this.reallocateStalledOrders();
    } catch (err) {
      // A failed sweep must not kill the cron — the next tick retries.
      winstonLogger.warn(
        `Offer expiry sweep failed: ${(err as Error).message}`,
        LOG_META,
      );
    }
  }

  /**
   * Re-runs allocation for orders left waiting with nothing outstanding.
   *
   * A manager's rejection arrives from Odoo and is applied by the sync
   * processor — which cannot call the allocator directly without the order and
   * sync modules depending on each other. So instead of wiring a call through,
   * the rejection simply becomes a STATE, and this sweep notices it: an order
   * still AWAITING_APPROVAL that has no live offer left is one nobody is going
   * to answer.
   *
   * That is also the more robust arrangement. A missed job, a crash mid-handler
   * or a decision applied while the worker was down all heal here, because the
   * condition is read from the data rather than from an event having fired.
   */
  async reallocateStalledOrders(): Promise<number> {
    const stalled = await this.offerRepo
      .createQueryBuilder('offer')
      .select('offer.orderId', 'orderId')
      .innerJoin(Order, 'o', 'o.id = offer.orderId')
      .where('o.status = :status', { status: OrderStatus.AWAITING_APPROVAL })
      .groupBy('offer.orderId')
      // No offer of this order is still open — every one was answered or timed
      // out, so nothing further will arrive on its own.
      .having(
        'SUM(CASE WHEN offer.status = :open THEN 1 ELSE 0 END) = 0',
        { open: OrderOfferStatus.OFFERED },
      )
      .setParameter('open', OrderOfferStatus.OFFERED)
      .getRawMany<{ orderId: string }>();

    for (const row of stalled) {
      await this.allocation.allocate(row.orderId);
    }
    if (stalled.length) {
      winstonLogger.info(
        `Re-allocated ${stalled.length} order(s) left with no open offer`,
        LOG_META,
      );
    }
    return stalled.length;
  }

  async expireOverdueOffers(now = new Date()): Promise<number> {
    const overdue = await this.offerRepo.find({
      where: { status: OrderOfferStatus.OFFERED, expiresAt: LessThan(now) },
    });
    if (!overdue.length) return 0;

    const ordersToRetry = new Set<string>();
    for (const offer of overdue) {
      offer.status = OrderOfferStatus.EXPIRED;
      offer.respondedAt = now;
      await this.offerRepo.save(offer);

      const part = await this.partRepo.findOne({ where: { id: offer.partId } });
      // Only a part still waiting is expired: the manager may have answered
      // between the query and this write, and their decision outranks a clock.
      if (!part || part.status !== OrderPartStatus.OFFERED) continue;

      part.status = OrderPartStatus.EXPIRED;
      part.stockReserved = false;
      await this.partRepo.save(part);

      // Withdraw it in Odoo too, so a manager returning from leave cannot
      // accept an offer the buyer's order has already moved past — and so the
      // reserved stock is genuinely released there.
      await this.odooSync.enqueueCancelOrderPart({
        partId: part.id,
        reason: 'Offer expired — no answer within the allowed window',
      });
      ordersToRetry.add(part.orderId);
    }

    // Reallocate once per order, not once per expired part.
    for (const orderId of ordersToRetry) {
      await this.allocation.allocate(orderId);
    }

    winstonLogger.info(
      `Expired ${overdue.length} unanswered offer(s); re-allocated ${ordersToRetry.size} order(s)`,
      LOG_META,
    );
    return overdue.length;
  }
}
