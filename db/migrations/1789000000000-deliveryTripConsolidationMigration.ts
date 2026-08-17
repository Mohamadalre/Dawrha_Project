import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks a delivery trip as a CONSOLIDATION run and records where it ends.
 *
 * A consolidation reuses the delivery-trip machinery (same truck, driver, milk
 * run) but ends at the warehouse nearest the buyer instead of the buyer's door,
 * gathering the far parts there. `is_consolidation` distinguishes it, and
 * `destination_warehouse_id` is the gathering warehouse (null for a delivery,
 * whose destination is always the buyer).
 */
export class DeliveryTripConsolidationMigration1789000000000 implements MigrationInterface {
  name = 'DeliveryTripConsolidationMigration1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_trips"
        ADD COLUMN IF NOT EXISTS "is_consolidation" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "destination_warehouse_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_trips"
        DROP COLUMN IF EXISTS "destination_warehouse_id",
        DROP COLUMN IF EXISTS "is_consolidation"
    `);
  }
}
