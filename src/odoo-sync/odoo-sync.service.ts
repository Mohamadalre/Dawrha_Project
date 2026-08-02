import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CancelShiftChangePayload,
  CreateWarehousePayload,
  DeleteCategoryPayload,
  DeleteProductPayload,
  DeleteConditionPayload,
  DeleteProvincePayload,
  CancelOrderPartPayload,
  OrderEventPayload,
  PushOrderPartPayload,
  UpdateWarehousePayload,
  DeleteUnitPayload,
  DriverDecisionPayload,
  PushDriverRequestPayload,
  PushHandoverPayload,
  PushShiftChangePayload,
  PushTruckProblemPayload,
  ShiftChangeDecisionPayload,
  ODOO_JOB_OPTIONS,
  ODOO_JOBS,
  ODOO_SYNC_QUEUE,
  SyncCategoryPayload,
  SyncConditionPayload,
  SyncProductPayload,
  SyncProvincePayload,
  SyncUnitPayload,
  SyncWarehousePayload,
  UpdatePricingPayload,
} from './odoo-sync.constants';

/**
 * Thin facade that enqueues Odoo synchronisation jobs with the correct
 * retry/backoff policy. Application services never call Odoo directly — they
 * enqueue here and the processor owns the RPC + compensation logic.
 */
@Injectable()
export class OdooSyncService {
  constructor(
    @InjectQueue(ODOO_SYNC_QUEUE) private readonly queue: Queue,
  ) {}

  private opts(job: string) {
    const policy = ODOO_JOB_OPTIONS[job];
    return {
      attempts: policy.attempts,
      backoff: { type: 'exponential', delay: policy.backoff },
      removeOnComplete: true,
      removeOnFail: false,
    };
  }

  enqueueSyncCategory(payload: SyncCategoryPayload) {
    return this.queue.add(ODOO_JOBS.SYNC_CATEGORY, payload, this.opts(ODOO_JOBS.SYNC_CATEGORY));
  }

  enqueueDeleteCategory(payload: DeleteCategoryPayload) {
    return this.queue.add(ODOO_JOBS.DELETE_CATEGORY, payload, this.opts(ODOO_JOBS.DELETE_CATEGORY));
  }

  enqueueSyncProduct(payload: SyncProductPayload) {
    return this.queue.add(ODOO_JOBS.SYNC_PRODUCT, payload, this.opts(ODOO_JOBS.SYNC_PRODUCT));
  }

  enqueueDeleteProduct(payload: DeleteProductPayload) {
    return this.queue.add(ODOO_JOBS.DELETE_PRODUCT, payload, this.opts(ODOO_JOBS.DELETE_PRODUCT));
  }

  enqueueUpdatePricing(payload: UpdatePricingPayload) {
    return this.queue.add(ODOO_JOBS.UPDATE_PRICING, payload, this.opts(ODOO_JOBS.UPDATE_PRICING));
  }

  enqueueSyncUnit(payload: SyncUnitPayload) {
    return this.queue.add(ODOO_JOBS.SYNC_UNIT, payload, this.opts(ODOO_JOBS.SYNC_UNIT));
  }

  enqueueDeleteUnit(payload: DeleteUnitPayload) {
    return this.queue.add(ODOO_JOBS.DELETE_UNIT, payload, this.opts(ODOO_JOBS.DELETE_UNIT));
  }

  enqueueSyncProvince(payload: SyncProvincePayload) {
    return this.queue.add(ODOO_JOBS.SYNC_PROVINCE, payload, this.opts(ODOO_JOBS.SYNC_PROVINCE));
  }

  enqueueDeleteProvince(payload: DeleteProvincePayload) {
    return this.queue.add(ODOO_JOBS.DELETE_PROVINCE, payload, this.opts(ODOO_JOBS.DELETE_PROVINCE));
  }

  /**
   * Full governorate re-push (startup + reconcile cron). A minute-bucketed
   * jobId collapses overlapping triggers into ONE job: the sync is an
   * idempotent full replace, so running it twice back-to-back is pure waste.
   */
  enqueueSyncAllProvinces() {
    const bucket = Math.floor(Date.now() / 60_000);
    return this.queue.add(
      ODOO_JOBS.SYNC_ALL_PROVINCES,
      {},
      { ...this.opts(ODOO_JOBS.SYNC_ALL_PROVINCES), jobId: `provinces-reconcile-${bucket}` },
    );
  }

  /**
   * Re-read the delivery tariffs Odoo owns. Payload-less and bucketed: a burst
   * of admin edits collapses into ONE re-read, which is safe because the job
   * replaces the whole mirror rather than applying a diff.
   */
  enqueueSyncDeliveryTariffs() {
    const bucket = Math.floor(Date.now() / 60_000);
    return this.queue.add(
      ODOO_JOBS.SYNC_DELIVERY_TARIFFS,
      {},
      { ...this.opts(ODOO_JOBS.SYNC_DELIVERY_TARIFFS), jobId: `delivery-tariffs-${bucket}` },
    );
  }

  enqueuePushOrderPart(payload: PushOrderPartPayload) {
    return this.queue.add(ODOO_JOBS.PUSH_ORDER_PART, payload, this.opts(ODOO_JOBS.PUSH_ORDER_PART));
  }

  enqueueCancelOrderPart(payload: CancelOrderPartPayload) {
    return this.queue.add(ODOO_JOBS.CANCEL_ORDER_PART, payload, this.opts(ODOO_JOBS.CANCEL_ORDER_PART));
  }

  /**
   * A warehouse decision coming back from Odoo. The jobId keys on the part AND
   * the event, so a webhook Odoo retried does not apply the same decision
   * twice — approving an order once is not the same as approving it twice when
   * the second approval races a rejection.
   */
  enqueueOrderEvent(payload: OrderEventPayload) {
    return this.queue.add(
      ODOO_JOBS.APPLY_ORDER_EVENT,
      payload,
      {
        ...this.opts(ODOO_JOBS.APPLY_ORDER_EVENT),
        jobId: `order-event-${payload.partId}-${payload.event}`,
      },
    );
  }

  enqueueSyncCondition(payload: SyncConditionPayload) {
    return this.queue.add(ODOO_JOBS.SYNC_CONDITION, payload, this.opts(ODOO_JOBS.SYNC_CONDITION));
  }

  enqueueDeleteCondition(payload: DeleteConditionPayload) {
    return this.queue.add(ODOO_JOBS.DELETE_CONDITION, payload, this.opts(ODOO_JOBS.DELETE_CONDITION));
  }

  enqueueSyncFleet() {
    return this.queue.add(ODOO_JOBS.SYNC_FLEET, {}, this.opts(ODOO_JOBS.SYNC_FLEET));
  }

  /**
   * Reconciliation enqueue (periodic / startup catch-up). Uses a time-bucketed
   * jobId so that several triggers landing in the same minute collapse into ONE
   * job instead of stacking: the fleet sync is a full idempotent re-read, so
   * running it twice back-to-back is pure waste.
   */
  enqueueSyncFleetReconcile() {
    const bucket = Math.floor(Date.now() / 60_000); // 1-minute bucket
    return this.queue.add(
      ODOO_JOBS.SYNC_FLEET,
      {},
      { ...this.opts(ODOO_JOBS.SYNC_FLEET), jobId: `fleet-reconcile-${bucket}` },
    );
  }

  enqueuePushDriverRequest(payload: PushDriverRequestPayload) {
    return this.queue.add(ODOO_JOBS.PUSH_DRIVER_REQUEST, payload, this.opts(ODOO_JOBS.PUSH_DRIVER_REQUEST));
  }

  /**
   * Reconciliation re-push (from the driver-request cron). A minute-bucketed
   * jobId per account collapses overlapping ticks into ONE job instead of
   * stacking duplicates — the Odoo upsert makes an occasional repeat harmless.
   */
  enqueuePushDriverRequestReconcile(accountId: string) {
    const bucket = Math.floor(Date.now() / 60_000);
    return this.queue.add(
      ODOO_JOBS.PUSH_DRIVER_REQUEST,
      { accountId },
      { ...this.opts(ODOO_JOBS.PUSH_DRIVER_REQUEST), jobId: `driver-repush-${accountId}-${bucket}` },
    );
  }

  enqueuePushShiftChange(payload: PushShiftChangePayload) {
    return this.queue.add(ODOO_JOBS.PUSH_SHIFT_CHANGE, payload, this.opts(ODOO_JOBS.PUSH_SHIFT_CHANGE));
  }

  enqueueCancelShiftChange(payload: CancelShiftChangePayload) {
    return this.queue.add(ODOO_JOBS.CANCEL_SHIFT_CHANGE, payload, this.opts(ODOO_JOBS.CANCEL_SHIFT_CHANGE));
  }

  enqueuePushTruckProblem(payload: PushTruckProblemPayload) {
    return this.queue.add(ODOO_JOBS.PUSH_TRUCK_PROBLEM, payload, this.opts(ODOO_JOBS.PUSH_TRUCK_PROBLEM));
  }

  enqueuePushHandoverPickup(payload: PushHandoverPayload) {
    return this.queue.add(ODOO_JOBS.PUSH_HANDOVER_PICKUP, payload, this.opts(ODOO_JOBS.PUSH_HANDOVER_PICKUP));
  }

  enqueuePushHandoverDropoff(payload: PushHandoverPayload) {
    return this.queue.add(ODOO_JOBS.PUSH_HANDOVER_DROPOFF, payload, this.opts(ODOO_JOBS.PUSH_HANDOVER_DROPOFF));
  }

  enqueueDriverDecision(payload: DriverDecisionPayload) {
    return this.queue.add(ODOO_JOBS.APPLY_DRIVER_DECISION, payload, this.opts(ODOO_JOBS.APPLY_DRIVER_DECISION));
  }

  enqueueShiftChangeDecision(payload: ShiftChangeDecisionPayload) {
    return this.queue.add(
      ODOO_JOBS.APPLY_SHIFT_CHANGE_DECISION,
      payload,
      this.opts(ODOO_JOBS.APPLY_SHIFT_CHANGE_DECISION),
    );
  }

  /**
   * Mirrors a warehouse edit into Odoo. Queued, not inline: the admin’s save
   * must not fail because Odoo is briefly unreachable.
   */
  enqueueUpdateWarehouse(payload: UpdateWarehousePayload) {
    return this.queue.add(
      ODOO_JOBS.UPDATE_WAREHOUSE,
      payload,
      this.opts(ODOO_JOBS.UPDATE_WAREHOUSE),
    );
  }

  enqueueCreateWarehouse(payload: CreateWarehousePayload) {
    return this.queue.add(
      ODOO_JOBS.CREATE_WAREHOUSE,
      payload,
      this.opts(ODOO_JOBS.CREATE_WAREHOUSE),
    );
  }

  async enqueueSyncWarehouse(payload: SyncWarehousePayload) {
    const job = await this.queue.add(
      ODOO_JOBS.SYNC_WAREHOUSE,
      payload,
      this.opts(ODOO_JOBS.SYNC_WAREHOUSE),
    );
    return job;
  }
}
