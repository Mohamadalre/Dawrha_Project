import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { OrderPart } from '@src/order/entities/order-part.entity';
import {
  OrderPartStatus,
  canTransitionPart,
} from '@src/order/enums/order-part-status.enum';
import { resolvePartStatus } from '@src/order/order-event-map';
import { OdooOrderState, OdooService } from '@src/odoo/odoo.service';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'ORDER_STATE_RECONCILE', channel: 'jobs' } as const;

/** Don't replay an event a webhook may still be delivering. */
const GRACE_MS = 5 * 60 * 1000;

/** Cap the work one tick can schedule after a long outage. */
const BATCH = 200;

/**
 * Parts the buyer or the clock ended. Odoo must be told to stop working on
 * these; if it was not, a warehouse is preparing goods nobody will collect.
 */
const DEAD_PART_STATUSES: readonly OrderPartStatus[] = [
  OrderPartStatus.CANCELLED,
  OrderPartStatus.EXPIRED,
  OrderPartStatus.REJECTED,
];

/**
 * Parts still moving. A delivered part is finished business — re-reading it for
 * the life of the database buys nothing.
 */
const OPEN_STATUSES: readonly OrderPartStatus[] = [
  OrderPartStatus.OFFERED,
  OrderPartStatus.ACCEPTED,
  OrderPartStatus.PROCESSING,
  OrderPartStatus.STOCK_DEDUCTED,
  OrderPartStatus.IN_OUTPUT_ZONE,
  OrderPartStatus.READY_FOR_PICKUP,
  OrderPartStatus.DISPATCHED,
];

/**
 * Converges the ORDER progress between Odoo and the backend after an outage.
 *
 * Odoo reports every step a warehouse takes through `_notify_backend`, which
 * swallows failures on purpose: a warehouse employee must never be blocked
 * because the backend is briefly unreachable. That is the right trade — but it
 * left the event with nowhere to go. The comment there claimed "the backend's
 * reconcile pass re-reads anything lost"; there was no such pass. Fleet,
 * warehouse, province and tariff data all had one. Orders did not.
 *
 * So a single dropped call left the buyer's order frozen at whatever it last
 * heard — "accepted" while the goods were boxed, invoiced and handed to a
 * carrier — with nothing that would ever correct it. The warehouse sees a
 * finished job; the buyer sees a stalled order; neither side has a reason to
 * look again.
 *
 * This closes it the same way the other mirrors do: read Odoo, derive the
 * furthest point each part has reached, and replay the ordinary
 * APPLY_ORDER_EVENT job for anything the backend has not caught up with.
 * Replaying is safe by construction — `canTransitionPart` refuses to move a
 * part backwards, so an event the backend already applied is a no-op.
 */
@Injectable()
export class OrderStateReconcileService implements OnModuleInit {
  constructor(
    @InjectRepository(OrderPart)
    private readonly partRepo: Repository<OrderPart>,
    private readonly odoo: OdooService,
    private readonly odooSync: OdooSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  async reconcile(
    trigger: 'startup' | 'cron' | 'manual',
  ): Promise<{ replayed: number; recancelled: number }> {
    const result = { replayed: 0, recancelled: 0 };
    try {
      // Withdrawn orders Odoo is still working on. Runs FIRST and independently
      // of the forward pass: it used to sit after the early return below, so a
      // system with no open parts — the quiet case, and exactly when a stale
      // live order in Odoo matters most — never ran it at all.
      result.recancelled = await this.recancel(trigger);

      // Only parts old enough that a webhook is no longer plausibly in flight.
      const parts = await this.partRepo.find({
        where: {
          status: In(OPEN_STATUSES as OrderPartStatus[]),
          updatedAt: LessThan(new Date(Date.now() - GRACE_MS)),
        },
        take: BATCH,
      });
      if (!parts.length) return result;

      let states: OdooOrderState[];
      try {
        states = await this.odoo.fetchOpenOrderStates(parts.map((p) => p.id));
      } catch (err) {
        winstonLogger.warn(
          `Order-state reconcile skipped (${trigger}) — Odoo unreachable: ${(err as Error).message}`,
          LOG_META,
        );
        return result;
      }

      const byPart = new Map(states.map((s) => [s.backendPartId, s]));
      for (const part of parts) {
        const state = byPart.get(part.id);
        // Never pushed to Odoo. That is PushReconcile.repushOrderParts' job —
        // which, when this line was first written, did not exist: the comment
        // deferred to a safety net that was not there, and order parts were the
        // one push in the system with no cover at all.
        if (!state) continue;

        const event = this.furthestEvent(state);
        if (!event) continue; // the warehouse has not started on it

        const target = resolvePartStatus(event, state.handoverType ?? undefined);
        if (!target || target === part.status) continue;
        // The one question that matters: is the backend BEHIND Odoo? A part
        // that cannot legally move to `target` is either already past it or
        // somewhere unrelated — replaying would be rewriting history.
        if (!canTransitionPart(part.status, target)) continue;

        await this.odooSync.enqueueOrderEvent({
          partId: part.id,
          odooOrderId: state.odooOrderId,
          event,
          ...(state.invoiceNumber ? { invoiceNumber: state.invoiceNumber } : {}),
          ...(state.outputZone ? { outputZone: state.outputZone } : {}),
          ...(state.handoverType ? { handoverType: state.handoverType } : {}),
          ...(state.approvalRejectReason
            ? { rejectReason: state.approvalRejectReason }
            : {}),
        });
        result.replayed++;
        winstonLogger.warn(
          `Replaying lost Odoo order event "${event}" for part ${part.id}: ` +
            `backend=${part.status} -> ${target}`,
          LOG_META,
        );
      }

      if (result.replayed) {
        winstonLogger.info(
          `Replayed ${result.replayed} lost order event(s) from Odoo (${trigger})`,
          LOG_META,
        );
      }
    } catch (err) {
      winstonLogger.warn(
        `Order-state reconcile error (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
    return result;
  }

  /**
   * Orders the buyer withdrew that Odoo is still working on.
   *
   * The mirror image of a lost push, and worse than it. When a buyer cancels or
   * an offer expires, the backend settles the part and enqueues a cancel; if
   * that job is lost, Odoo keeps a live order — so a warehouse picks it up,
   * deducts real stock, prints an invoice and prepares goods for somebody who
   * cancelled. Nothing caught it: every other pass here walks parts that are
   * still moving, and a cancelled part is by definition not one of those.
   *
   * Re-enqueuing the ordinary cancel job is idempotent — Odoo keys the cancel
   * on the part id and a second one is a no-op.
   */
  private async recancel(trigger: string): Promise<number> {
    const settled = await this.partRepo.find({
      where: {
        status: In(DEAD_PART_STATUSES as OrderPartStatus[]),
        odooOrderId: Not(IsNull()),
        updatedAt: LessThan(new Date(Date.now() - GRACE_MS)),
      },
      take: BATCH,
    });
    if (!settled.length) return 0;

    let states: OdooOrderState[];
    try {
      states = await this.odoo.fetchOpenOrderStates(settled.map((p) => p.id));
    } catch {
      return 0; // next tick retries
    }
    const byPart = new Map(states.map((s) => [s.backendPartId, s]));

    let count = 0;
    for (const part of settled) {
      const state = byPart.get(part.id);
      // Odoo already knows it is over — nothing to do.
      if (!state || state.state === 'cancelled') continue;
      await this.odooSync.enqueueCancelOrderPart({
        partId: part.id,
        reason: 'Cancelled in the backend — reconciliation',
      });
      count++;
      winstonLogger.warn(
        `Re-cancelling order part ${part.id} in Odoo (${trigger}): ` +
          `backend=${part.status} but Odoo still shows "${state.state}"`,
        LOG_META,
      );
    }
    return count;
  }

  /**
   * The furthest step Odoo's fields prove this part has reached.
   *
   * Odoo's order fields are cumulative rather than a single status — an order
   * that has been handed over still carries its approval and its deduction
   * timestamp. So the checks run newest-first and the first match wins:
   * replaying the LAST event is enough, because the part's own transition
   * table walks it there and the intermediate ones carry no information the
   * final one lacks.
   *
   * Rejection is tested before everything else: a refused order never entered
   * the pipeline, so any other field on it describes a path not taken.
   */
  private furthestEvent(state: OdooOrderState): string | null {
    if (state.managerApproval === 'rejected') return 'manager_rejected';
    if (state.handoverState === 'handed_over' && state.handoverType) return 'handed_over';
    if (state.state === 'completed') return 'completed';
    if (state.stockDeducted || state.state === 'ready') return 'stock_deducted';
    if (state.state === 'processing') return 'processing';
    if (state.managerApproval === 'approved') return 'manager_approved';
    return null;
  }
}
