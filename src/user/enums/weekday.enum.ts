/**
 * Days of the week, for a factory's detailed delivery-time windows.
 *
 * A factory no longer picks one coarse slot (morning/afternoon/…). It gives the
 * exact windows it can receive a delivery in, each pinned to a weekday — so the
 * dispatcher can match a trip to a day the buyer is actually open.
 */
export enum Weekday {
  SUNDAY = 'SUNDAY',
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
}
