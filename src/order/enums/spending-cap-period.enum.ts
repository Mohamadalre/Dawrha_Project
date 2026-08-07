/**
 * The window a spending cap is measured over.
 *
 * DAILY resets at local midnight; MONTHLY resets on the first of the month. A
 * cap is one or the other, never both — "500 a day" and "5000 a month" are two
 * different policies, and an admin picks the one that matches how they think
 * about the role's risk.
 */
export enum SpendingCapPeriod {
  DAILY = 'DAILY',
  MONTHLY = 'MONTHLY',
}
