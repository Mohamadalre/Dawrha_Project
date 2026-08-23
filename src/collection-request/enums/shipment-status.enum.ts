/**
 * Lifecycle of a shipment: groups multiple collected requests into one
 * warehouse delivery. A driver creates a shipment after collecting, then
 * marks it delivered when he physically drops the load at the warehouse.
 */
export enum ShipmentStatus {
  CREATED = 'CREATED',
  IN_TRANSIT = 'IN_TRANSIT',
  /** The driver dropped the load at the warehouse (auto when his route ends). */
  DELIVERED = 'DELIVERED',
  /**
   * The RECEPTION employee scanned the shipment's QR and confirmed receipt —
   * the load was logged into Odoo as one `recycle.shipment`. Only reception
   * moves a shipment here, and the driver sees the change.
   */
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export const SHIPMENT_TRANSITIONS: Record<
  ShipmentStatus,
  readonly ShipmentStatus[]
> = {
  [ShipmentStatus.CREATED]: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.IN_TRANSIT]: [
    ShipmentStatus.DELIVERED,
    // Reception may confirm receipt even if the auto route-complete step has
    // not yet marked it DELIVERED (a shipment scanned the moment it arrives).
    ShipmentStatus.RECEIVED,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.DELIVERED]: [ShipmentStatus.RECEIVED],
  [ShipmentStatus.RECEIVED]: [],
  [ShipmentStatus.CANCELLED]: [],
};

export function canTransitionShipment(
  from: ShipmentStatus,
  to: ShipmentStatus,
): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}
