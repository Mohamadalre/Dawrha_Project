import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A complaint is filed against the WHOLE ORDER, not a part.
 *
 * The buyer sees one order and never the warehouse split behind it, so a
 * per-part complaint asked them to reason about something they cannot see.
 * `part_id` and `warehouse_id` become NULLABLE: an order-level complaint carries
 * neither (it names only the order), and a warehouse-routed one is fanned out to
 * every warehouse that fulfilled the order at notify time. Existing part-scoped
 * rows are untouched — their columns stay filled.
 */
export class OrderComplaintWholeOrderMigration1789700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_complaints" ALTER COLUMN "part_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_complaints" ALTER COLUMN "warehouse_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-imposing NOT NULL would fail against any order-level complaint filed in
    // the meantime (its part_id/warehouse_id are null by design), so the down
    // migration clears those rows first — they are the ones the up enabled.
    await queryRunner.query(
      `DELETE FROM "order_complaints" WHERE "part_id" IS NULL OR "warehouse_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_complaints" ALTER COLUMN "warehouse_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_complaints" ALTER COLUMN "part_id" SET NOT NULL`,
    );
  }
}
