/**
 * Truck availability status.
 *  - ACTIVE / DISABLED are set by the admin.
 *  - BUSY_ONE_DRIVER / FULLY_BUSY are DERIVED from driver assignments and must
 *    never be set manually (a truck has 2 shifts → at most 2 drivers; one driver
 *    = BUSY_ONE_DRIVER, both shifts filled = FULLY_BUSY).
 */
export enum TruckStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
  BUSY_ONE_DRIVER = 'busy_one_driver',
  FULLY_BUSY = 'fully_busy',
}

/** Statuses an admin may set directly. */
export const ADMIN_SETTABLE_TRUCK_STATUSES = [TruckStatus.ACTIVE, TruckStatus.DISABLED] as const;
