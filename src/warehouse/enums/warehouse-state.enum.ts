/**
 * Warehouse lifecycle — mirrored from Odoo's `recycle.warehouse.state`, which
 * is the owner of this decision (a warehouse is closed from the Odoo admin
 * screen, never from here).
 *
 * The middle state is the reason this is not a boolean: a warehouse that stops
 * taking NEW work must still ship out what it already holds, so `isActive`
 * alone cannot express it.
 */
export enum WarehouseState {
  /** Normal — the only state order allocation may choose. */
  ACTIVE = 'ACTIVE',
  /** Winding down: no new orders, existing stock still leaves. */
  CLOSING = 'CLOSING',
  /** Fully stopped. */
  INACTIVE = 'INACTIVE',
}

/** Odoo writes lowercase keys; this maps them onto the enum. */
export function warehouseStateFromOdoo(value: unknown): WarehouseState {
  const key = String(value ?? '').trim().toUpperCase();
  return (WarehouseState as Record<string, WarehouseState>)[key]
    ?? WarehouseState.ACTIVE;
}
