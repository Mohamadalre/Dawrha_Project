import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CreateWarehousePayload,
  DeleteCategoryPayload,
  DeleteProductPayload,
  DeleteConditionPayload,
  DeleteUnitPayload,
  DriverDecisionPayload,
  PushDriverRequestPayload,
  PushShiftChangePayload,
  ShiftChangeDecisionPayload,
  ODOO_JOB_OPTIONS,
  ODOO_JOBS,
  ODOO_SYNC_QUEUE,
  SyncCategoryPayload,
  SyncConditionPayload,
  SyncProductPayload,
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

  enqueueSyncCondition(payload: SyncConditionPayload) {
    return this.queue.add(ODOO_JOBS.SYNC_CONDITION, payload, this.opts(ODOO_JOBS.SYNC_CONDITION));
  }

  enqueueDeleteCondition(payload: DeleteConditionPayload) {
    return this.queue.add(ODOO_JOBS.DELETE_CONDITION, payload, this.opts(ODOO_JOBS.DELETE_CONDITION));
  }

  enqueueSyncFleet() {
    return this.queue.add(ODOO_JOBS.SYNC_FLEET, {}, this.opts(ODOO_JOBS.SYNC_FLEET));
  }

  enqueuePushDriverRequest(payload: PushDriverRequestPayload) {
    return this.queue.add(ODOO_JOBS.PUSH_DRIVER_REQUEST, payload, this.opts(ODOO_JOBS.PUSH_DRIVER_REQUEST));
  }

  enqueuePushShiftChange(payload: PushShiftChangePayload) {
    return this.queue.add(ODOO_JOBS.PUSH_SHIFT_CHANGE, payload, this.opts(ODOO_JOBS.PUSH_SHIFT_CHANGE));
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
