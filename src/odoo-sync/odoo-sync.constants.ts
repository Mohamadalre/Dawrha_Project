export const ODOO_SYNC_QUEUE = 'waste-odoo-sync';

export const ODOO_JOBS = {
  SYNC_CATEGORY: 'sync-category-to-odoo',
  DELETE_CATEGORY: 'delete-category-from-odoo',
  SYNC_PRODUCT: 'sync-product-to-odoo',
  DELETE_PRODUCT: 'delete-product-from-odoo',
  UPDATE_PRICING: 'update-product-pricing',
  CREATE_WAREHOUSE: 'create-warehouse-to-odoo',
  SYNC_WAREHOUSE: 'sync-warehouse-from-odoo',
  SYNC_UNIT: 'sync-unit-to-odoo',
  DELETE_UNIT: 'delete-unit-from-odoo',
  SYNC_CONDITION: 'sync-condition-to-odoo',
  DELETE_CONDITION: 'delete-condition-from-odoo',
  SYNC_FLEET: 'sync-fleet-from-odoo',
  PUSH_DRIVER_REQUEST: 'push-driver-request-to-odoo',
  PUSH_SHIFT_CHANGE: 'push-shift-change-to-odoo',
  APPLY_DRIVER_DECISION: 'apply-driver-decision-from-odoo',
  APPLY_SHIFT_CHANGE_DECISION: 'apply-shift-change-decision-from-odoo',
} as const;

export type OdooJobName = (typeof ODOO_JOBS)[keyof typeof ODOO_JOBS];

/** Per-job retry/backoff/timeout policy (from the brief). */
export const ODOO_JOB_OPTIONS: Record<string, { attempts: number; backoff: number }> = {
  [ODOO_JOBS.SYNC_CATEGORY]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.DELETE_CATEGORY]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_PRODUCT]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.DELETE_PRODUCT]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.UPDATE_PRICING]: { attempts: 2, backoff: 2000 },
  [ODOO_JOBS.CREATE_WAREHOUSE]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_WAREHOUSE]: { attempts: 2, backoff: 10000 },
  [ODOO_JOBS.SYNC_UNIT]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.DELETE_UNIT]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_CONDITION]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.DELETE_CONDITION]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_FLEET]: { attempts: 2, backoff: 10000 },
  [ODOO_JOBS.PUSH_DRIVER_REQUEST]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.PUSH_SHIFT_CHANGE]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.APPLY_DRIVER_DECISION]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.APPLY_SHIFT_CHANGE_DECISION]: { attempts: 3, backoff: 5000 },
};

export interface SyncCategoryPayload {
  categoryId: string;
}
export interface DeleteCategoryPayload {
  odooCategoryId: number;
}
export interface SyncProductPayload {
  productId: string;
}
export interface DeleteProductPayload {
  odooProductId: number;
}
export interface UpdatePricingPayload {
  productId: string;
}
export interface CreateWarehousePayload {
  warehouseId: string;
}
export interface SyncWarehousePayload {
  warehouseId: string;
  jobId: string;
  forceFullSync?: boolean;
}
export interface SyncUnitPayload {
  unitId: string;
}
export interface DeleteUnitPayload {
  odooUnitId: number;
}
export interface SyncConditionPayload {
  conditionId: string;
}
export interface DeleteConditionPayload {
  odooConditionId: number;
}
export interface PushDriverRequestPayload {
  accountId: string;
}
export interface PushShiftChangePayload {
  requestId: string;
}
export interface DriverDecisionPayload {
  /** Collector profile id the backend sent as backend_driver_id. */
  backendDriverId: string;
  approved?: boolean;
  /** Explicit status (ACTIVE/REJECTED/BLOCKED/NEED_CHANGES) — overrides `approved`. */
  status?: string;
  rejectionReason?: string;
  /** Optional immediate assignment decided by the Odoo admin. */
  truckOdooId?: number;
  shiftOdooId?: number;
}
export interface ShiftChangeDecisionPayload {
  /** Backend request id echoed back by Odoo. */
  requestId: string;
  approved: boolean;
  rejectionReason?: string;
}
