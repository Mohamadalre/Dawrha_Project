export const ODOO_SYNC_QUEUE = 'waste-odoo-sync';

export const ODOO_JOBS = {
  SYNC_CATEGORY: 'sync-category-to-odoo',
  DELETE_CATEGORY: 'delete-category-from-odoo',
  SYNC_PRODUCT: 'sync-product-to-odoo',
  DELETE_PRODUCT: 'delete-product-from-odoo',
  UPDATE_PRICING: 'update-product-pricing',
  CREATE_WAREHOUSE: 'create-warehouse-to-odoo',
  SYNC_WAREHOUSE: 'sync-warehouse-from-odoo',
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
