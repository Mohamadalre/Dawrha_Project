/**
 * How often an institution's collection plan repeats.
 *
 * The field set that must accompany each frequency:
 * - DAILY:   every day at `collectionTime`
 * - WEEKLY:  `weekdays` (ISO 1=Monday .. 7=Sunday)
 * - MONTHLY: `month_days` (1..31)
 */
export enum CollectionPlanFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}
