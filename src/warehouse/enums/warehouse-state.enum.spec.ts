import { WarehouseState, warehouseStateFromOdoo } from './warehouse-state.enum';

/**
 * The Odoo → backend lifecycle mapping.
 *
 * A TEMPORARY closing must leave the backend warehouse ACTIVE — it keeps taking
 * part until it is shut down permanently. Only Odoo's final `inactive` stop
 * makes it INACTIVE, and reopening (`active`) brings it back. This is the whole
 * of the "closing keeps it active; only a permanent close deactivates; reopen
 * reactivates" rule.
 */
describe('warehouseStateFromOdoo', () => {
  it('maps a normal warehouse to ACTIVE', () => {
    expect(warehouseStateFromOdoo('active')).toBe(WarehouseState.ACTIVE);
  });

  it('maps a TEMPORARY closing to ACTIVE (stays operational in the backend)', () => {
    expect(warehouseStateFromOdoo('closing')).toBe(WarehouseState.ACTIVE);
    expect(warehouseStateFromOdoo('CLOSING')).toBe(WarehouseState.ACTIVE);
  });

  it('maps a PERMANENT close to INACTIVE', () => {
    expect(warehouseStateFromOdoo('inactive')).toBe(WarehouseState.INACTIVE);
  });

  it('reopening (active) returns to ACTIVE', () => {
    expect(warehouseStateFromOdoo('active')).toBe(WarehouseState.ACTIVE);
  });

  it('falls back to ACTIVE for anything unrecognised or empty', () => {
    expect(warehouseStateFromOdoo(undefined)).toBe(WarehouseState.ACTIVE);
    expect(warehouseStateFromOdoo('')).toBe(WarehouseState.ACTIVE);
    expect(warehouseStateFromOdoo('nonsense')).toBe(WarehouseState.ACTIVE);
  });
});
