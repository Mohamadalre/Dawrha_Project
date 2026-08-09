import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames `delivery_rates."createdAt"/"updatedAt"` to snake_case.
 *
 * The table was created with camelCase timestamp columns, but the entity uses
 * `@CreateDateColumn()/@UpdateDateColumn()` which — under the project's
 * SnakeNamingStrategy — map to `created_at`/`updated_at`. The mismatch made
 * EVERY read of the table fail with `column DeliveryRate.created_at does not
 * exist` (a 500 on GET /admin/delivery-rate and anything that lists rates).
 * Renaming the columns to the names the entity expects fixes it in place,
 * without touching the stored data.
 */
export class FixDeliveryRateTimestampsMigration1788100000000 implements MigrationInterface {
  name = 'FixDeliveryRateTimestampsMigration1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_rates" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_rates" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_rates" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_rates" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
  }
}
