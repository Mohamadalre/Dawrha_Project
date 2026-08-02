/**
 * Where a product proposal came from.
 *
 * Recorded explicitly rather than inferred from a missing account: the review
 * screen shows both queues, and an admin deciding on a proposal needs to know
 * whether the person waiting for an answer is a buyer in the app or a colleague
 * standing in an Odoo warehouse.
 */
export enum SuggestionSource {
  APP = 'APP',
  ODOO = 'ODOO',
}
