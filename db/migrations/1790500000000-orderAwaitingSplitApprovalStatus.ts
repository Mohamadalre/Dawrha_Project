import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The allocator marks a split order `AWAITING_SPLIT_APPROVAL` — the buyer's
 * order was divided across warehouses and now waits for the admin to decide it
 * as one. The `OrderStatus` enum carries the value, but the Postgres
 * `orders_status_enum` was never given it, so EVERY split checkout died with
 * `invalid input value for enum orders_status_enum: "AWAITING_SPLIT_APPROVAL"`
 * — no split order could ever be placed. Add the value.
 */
export class OrderAwaitingSplitApprovalStatus1790500000000
  implements MigrationInterface
{
  name = 'OrderAwaitingSplitApprovalStatus1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."orders_status_enum" ADD VALUE IF NOT EXISTS 'AWAITING_SPLIT_APPROVAL'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; leaving it is harmless.
  }
}
