import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Snapshot of what the buyer asked for, frozen onto the order while it waits at
 * NEEDS_CUSTOMER_DECISION.
 *
 * By the time an order parks there the cart is emptied and no parts exist, so
 * there is nowhere else to read the request from when the buyer later accepts
 * the available quantity. jsonb, nullable, cleared the moment allocation
 * proceeds.
 */
export class OrderRequestedLinesMigration1788300000000
  implements MigrationInterface
{
  name = 'OrderRequestedLinesMigration1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "requested_lines" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "requested_lines"`,
    );
  }
}
