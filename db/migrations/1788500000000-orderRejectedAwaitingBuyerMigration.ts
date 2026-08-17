import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New order status: REJECTED_AWAITING_BUYER.
 *
 * A split order refused by the Odoo administrator is not re-allocated the way a
 * single warehouse's rejection is — the whole split was one verdict, so there is
 * nothing left to try. The order waits here for the buyer to confirm before it
 * closes.
 *
 * Adding the value (without using it in the same migration) is accepted inside
 * a transaction on Postgres 12+, which is what the stack runs.
 */
export class OrderRejectedAwaitingBuyerMigration1788500000000
  implements MigrationInterface
{
  name = 'OrderRejectedAwaitingBuyerMigration1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "orders_status_enum" ADD VALUE IF NOT EXISTS 'REJECTED_AWAITING_BUYER'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; leaving it in place is harmless
    // (no row references it once the feature is rolled back) and reversible only
    // by recreating the type, which is not worth the risk here.
  }
}
