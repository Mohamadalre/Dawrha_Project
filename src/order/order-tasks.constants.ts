/**
 * A small in-process queue for ORDER work that must run outside the request (or
 * event) that discovered it, and that needs the order module's own services.
 *
 * Kept separate from the Odoo-sync queue on purpose: this one is consumed INSIDE
 * the order module (its processor injects DeliveryTripService), so the Odoo-sync
 * module can enqueue to it without importing the order module — the two only
 * agree on a queue name, never on a dependency, which is what keeps the modules
 * free of a cycle.
 */
export const ORDER_TASKS_QUEUE = 'order-tasks';

export const ORDER_TASKS = {
  /** Gather a consolidation order now that every warehouse has prepared. */
  PLAN_CONSOLIDATION: 'plan-consolidation',
} as const;

export type OrderTaskName = (typeof ORDER_TASKS)[keyof typeof ORDER_TASKS];
