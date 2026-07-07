import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CreateWarehousePayload,
  DeleteCategoryPayload,
  DeleteProductPayload,
  ODOO_JOB_OPTIONS,
  ODOO_JOBS,
  ODOO_SYNC_QUEUE,
  SyncCategoryPayload,
  SyncProductPayload,
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
