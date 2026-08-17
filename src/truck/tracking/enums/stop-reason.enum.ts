export enum StopReason {
  /** Driver/admin explicitly ended the trip via `truck:stop`. */
  MANUAL_STOP = 'MANUAL_STOP',
  /** The driver's tracking socket disconnected. */
  DRIVER_DISCONNECT = 'DRIVER_DISCONNECT',
  /** No coordinates received within the inactivity window (cron). */
  INACTIVITY = 'INACTIVITY',
  /** The driver handed the truck back (dropoff) — the session ended cleanly. */
  HANDOVER_DROPOFF = 'HANDOVER_DROPOFF',
}
