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

/**
 * Odoo writes lowercase keys; this maps them onto the enum.
 *
 * `closing` is deliberately folded onto ACTIVE. A TEMPORARY closing is still
 * operational as far as the backend is concerned — the warehouse keeps taking
 * part until it is shut down PERMANENTLY. Only Odoo's final `inactive` stop
 * flips the mirror to INACTIVE, and reopening it returns the mirror to ACTIVE
 * on the very next sync. Mapping the transient `closing` to a non-active state
 * instead would quietly pull a warehouse out of allocation and the catalogue
 * the moment a shutdown merely *began* — which is not what a temporary closing
 * should do to the backend.
 *
 * The CLOSING enum member is kept (the mirror column is a Postgres enum that
 * still lists it, so removing it would need a migration) but is no longer
 * produced from an Odoo sync.
 */
export function warehouseStateFromOdoo(value: unknown): WarehouseState {
  const key = String(value ?? '').trim().toUpperCase();
  if (key === 'CLOSING') return WarehouseState.ACTIVE;
  return (WarehouseState as Record<string, WarehouseState>)[key]
    ?? WarehouseState.ACTIVE;
}
