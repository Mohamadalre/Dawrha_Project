export const ODOO_SYNC_QUEUE = 'waste-odoo-sync';

export const ODOO_JOBS = {
  SYNC_CATEGORY: 'sync-category-to-odoo',
  DELETE_CATEGORY: 'delete-category-from-odoo',
  SYNC_PRODUCT: 'sync-product-to-odoo',
  DELETE_PRODUCT: 'delete-product-from-odoo',
  UPDATE_PRICING: 'update-product-pricing',
  CREATE_WAREHOUSE: 'create-warehouse-to-odoo',
  SYNC_WAREHOUSE: 'sync-warehouse-from-odoo',
  UPDATE_WAREHOUSE: 'update-warehouse-in-odoo',
  SYNC_UNIT: 'sync-unit-to-odoo',
  DELETE_UNIT: 'delete-unit-from-odoo',
  SYNC_PROVINCE: 'sync-province-to-odoo',
  DELETE_PROVINCE: 'delete-province-from-odoo',
  SYNC_ALL_PROVINCES: 'sync-all-provinces-to-odoo',
  /** Re-read EVERY warehouse Odoo has, adopting any it created itself. */
  SYNC_ALL_WAREHOUSES: 'sync-all-warehouses-from-odoo',
  SYNC_DELIVERY_TARIFFS: 'sync-delivery-tariffs-from-odoo',
  PUSH_ORDER_PART: 'push-order-part-to-odoo',
  CANCEL_ORDER_PART: 'cancel-order-part-in-odoo',
  APPLY_ORDER_EVENT: 'apply-order-event-from-odoo',
  SYNC_CONDITION: 'sync-condition-to-odoo',
  DELETE_CONDITION: 'delete-condition-from-odoo',
  SYNC_FLEET: 'sync-fleet-from-odoo',
  PUSH_DRIVER_REQUEST: 'push-driver-request-to-odoo',
  PUSH_SHIFT_CHANGE: 'push-shift-change-to-odoo',
  CANCEL_SHIFT_CHANGE: 'cancel-shift-change-in-odoo',
  PUSH_TRUCK_PROBLEM: 'push-truck-problem-to-odoo',
  PUSH_HANDOVER_PICKUP: 'push-handover-pickup-to-odoo',
  PUSH_HANDOVER_DROPOFF: 'push-handover-dropoff-to-odoo',
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
  [ODOO_JOBS.UPDATE_WAREHOUSE]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_UNIT]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.DELETE_UNIT]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_PROVINCE]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.DELETE_PROVINCE]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_ALL_PROVINCES]: { attempts: 2, backoff: 10000 },
  [ODOO_JOBS.SYNC_ALL_WAREHOUSES]: { attempts: 2, backoff: 10000 },
  [ODOO_JOBS.SYNC_DELIVERY_TARIFFS]: { attempts: 2, backoff: 10000 },
  [ODOO_JOBS.PUSH_ORDER_PART]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.CANCEL_ORDER_PART]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.APPLY_ORDER_EVENT]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_CONDITION]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.DELETE_CONDITION]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.SYNC_FLEET]: { attempts: 2, backoff: 10000 },
  [ODOO_JOBS.PUSH_DRIVER_REQUEST]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.PUSH_SHIFT_CHANGE]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.CANCEL_SHIFT_CHANGE]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.PUSH_TRUCK_PROBLEM]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.PUSH_HANDOVER_PICKUP]: { attempts: 3, backoff: 5000 },
  [ODOO_JOBS.PUSH_HANDOVER_DROPOFF]: { attempts: 3, backoff: 5000 },
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
export interface UpdateWarehousePayload {
  warehouseId: string;
}
export interface SyncWarehousePayload {
  /**
   * The LOCAL row to refresh. Absent when the warehouse was created in Odoo and
   * has no mirror here yet — `odooWarehouseId` identifies it instead, and the
   * job adopts it.
   */
  warehouseId?: string;
  /**
   * The Odoo record. Carried so a warehouse BORN IN ODOO can be adopted: until
   * now an unknown id was answered with a 404, so a site created on that screen
   * could never appear here at all — no matter how many times it announced
   * itself.
   */
  odooWarehouseId?: number;
  jobId: string;
  forceFullSync?: boolean;
}
export interface SyncUnitPayload {
  unitId: string;
}
export interface DeleteUnitPayload {
  odooUnitId: number;
}
export interface SyncProvincePayload {
  provinceId: string;
}
export interface DeleteProvincePayload {
  /** Backend uuid — Odoo archives by it, so no Odoo id is needed. */
  backendProvinceId: string;
}
export interface PushOrderPartPayload {
  partId: string;
}
export interface CancelOrderPartPayload {
  partId: string;
  reason?: string;
}
/** One thing a warehouse did to one part, reported back from Odoo. */
export interface OrderEventPayload {
  partId: string;
  odooOrderId: number;
  event: string;
  invoiceNumber?: string;
  outputZone?: string;
  handoverType?: string;
  rejectReason?: string;
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
export interface CancelShiftChangePayload {
  /** Backend request id — Odoo's cancel action searches by it (idempotent). */
  backendRequestId: string;
}
export interface PushTruckProblemPayload {
  problemId: string;
}
export interface PushHandoverPayload {
  handoverId: string;
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
  /** Warehouse the driver was accepted into / moved to (Odoo id). */
  warehouseOdooId?: number;
  /**
   * True when the Odoo admin only MOVED the driver to another warehouse:
   * update the mirror, touch no status, send no notification.
   */
  warehouseChangeOnly?: boolean;
  /** Media rows the Odoo admin flagged as unacceptable (driver re-uploads). */
  rejectedMediaIds?: string[];
  /**
   * Mark those media rejected and do nothing else — no status change, no
   * notification. The reviewer is still working through the documents.
   */
  documentsOnly?: boolean;
  /**
   * Record those media as ASKED FOR and tell the driver. What is outstanding —
   * not what is rejected — decides when he has finished answering.
   */
  requestReupload?: boolean;
  /**
   * Withdraw those requests and put the driver back under review. The documents
   * keep their status — giving up waiting is not accepting what was sent.
   */
  cancelReupload?: boolean;
}
export interface ShiftChangeDecisionPayload {
  /** Backend request id echoed back by Odoo. */
  requestId: string;
  /** Manager's move: PROCESSING | ACCEPTED (with the truck) | REJECTED. */
  status: 'PROCESSING' | 'ACCEPTED' | 'REJECTED';
  /** Truck the manager reserved for the new shift (sent with ACCEPTED). */
  truckOdooId?: number;
  rejectionReason?: string;
}
