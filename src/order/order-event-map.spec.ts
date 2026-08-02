import {
  ODOO_EVENT_TO_PART_STATUS,
  autoAdvanceAfterPreparation,
  resolvePartStatus,
} from './order-event-map';
import { OrderPartStatus } from './enums/order-part-status.enum';
import { FulfilmentMode } from './enums/fulfilment-mode.enum';
import { ORDER_PART_TRANSITIONS } from './enums/order-part-status.enum';

describe('Odoo order events → part status', () => {
  it('maps the output employee\'s work through to the output zone', () => {
    expect(resolvePartStatus('manager_approved')).toBe(OrderPartStatus.ACCEPTED);
    expect(resolvePartStatus('processing')).toBe(OrderPartStatus.PROCESSING);
    expect(resolvePartStatus('stock_deducted')).toBe(OrderPartStatus.STOCK_DEDUCTED);
    expect(resolvePartStatus('completed')).toBe(OrderPartStatus.IN_OUTPUT_ZONE);
  });

  it('treats a manager rejection as a rejection of that part only', () => {
    expect(resolvePartStatus('manager_rejected')).toBe(OrderPartStatus.REJECTED);
  });

  it('reads the handover destination, not just the event', () => {
    // The manager's confirmation means different things to the buyer.
    expect(resolvePartStatus('handed_over', 'carrier')).toBe(OrderPartStatus.DISPATCHED);
    expect(resolvePartStatus('handed_over', 'buyer')).toBe(OrderPartStatus.DELIVERED);
  });

  it('ignores a handover with no destination rather than guessing', () => {
    expect(resolvePartStatus('handed_over')).toBeNull();
    expect(resolvePartStatus('handed_over', 'somewhere')).toBeNull();
  });

  it('ignores events it does not recognise', () => {
    // Inventing a status from an unknown event is how an order ends up
    // claiming to be somewhere it is not.
    expect(resolvePartStatus('some_future_event')).toBeNull();
    expect(resolvePartStatus('')).toBeNull();
  });

  it('never maps an event straight to "prepared AND gone"', () => {
    // "completed" in Odoo means the goods sit in an output zone. Only the
    // manager's handover may move a part past that.
    const reachable = Object.values(ODOO_EVENT_TO_PART_STATUS);
    expect(reachable).not.toContain(OrderPartStatus.DISPATCHED);
    expect(reachable).not.toContain(OrderPartStatus.DELIVERED);
  });

  it('lets a collection order be picked up as soon as it is prepared', () => {
    expect(
      autoAdvanceAfterPreparation(OrderPartStatus.IN_OUTPUT_ZONE, FulfilmentMode.PICKUP),
    ).toBe(OrderPartStatus.READY_FOR_PICKUP);
  });

  it('makes a delivery order wait for the manager to release it', () => {
    expect(
      autoAdvanceAfterPreparation(OrderPartStatus.IN_OUTPUT_ZONE, FulfilmentMode.DELIVERY),
    ).toBeNull();
  });

  it('auto-advances from no other status', () => {
    expect(
      autoAdvanceAfterPreparation(OrderPartStatus.ACCEPTED, FulfilmentMode.PICKUP),
    ).toBeNull();
  });

  it('only ever produces statuses the lifecycle actually allows', () => {
    // Guards against the map and the state machine drifting apart.
    const mapped = [
      ...Object.values(ODOO_EVENT_TO_PART_STATUS),
      OrderPartStatus.DISPATCHED,
      OrderPartStatus.DELIVERED,
      OrderPartStatus.READY_FOR_PICKUP,
    ];
    for (const status of mapped) {
      expect(ORDER_PART_TRANSITIONS[status]).toBeDefined();
    }
  });
});
