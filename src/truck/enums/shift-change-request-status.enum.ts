/**
 * Lifecycle of a driver's shift-change request.
 * PENDING (default) → PROCESSING → ACCEPTED, or → REJECTED (terminal).
 * A driver may cancel only while PENDING; admin processing requires PROCESSING.
 */
export enum ShiftChangeRequestStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}
