/**
 * How a collection request entered the system.
 *
 * The engine's scheduling rules differ per type: an IMMEDIATE request enters
 * the dispatch queue as soon as it is created, while SCHEDULED and ORG_PLAN
 * requests wait for a lead-time BullMQ job to open the queue window.
 */
export enum CollectionRequestType {
  /** Same-day pickup, enters dispatch immediately. */
  IMMEDIATE = 'IMMEDIATE',
  /** The producer chose a future pickup slot. */
  SCHEDULED = 'SCHEDULED',
  /** Generated automatically from an institution's collection plan. */
  ORG_PLAN = 'ORG_PLAN',
}
