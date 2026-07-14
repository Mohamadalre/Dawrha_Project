import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Measurement units — Odoo sorting integration:
 * 1) `allows_tolerance`: per-unit flag consumed by the separate Odoo warehouse
 *    project. true → the sorter's processed quantity may differ from the
 *    shipment's declared quantity; false → must match exactly (e.g. PIECE).
 *    Backfilled from `is_weight` (weight units tolerate, count units don't).
 * 2) `odoo_unit_id` + `odoo_sync_status`: mirror bookkeeping for the SYNC_UNIT
 *    Bull job that pushes units to Odoo (same pattern as categories/products).
 */
export class UnitToleranceMigration1783200000000 implements MigrationInterface {
  name = 'UnitToleranceMigration1783200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "measurement_units" ADD "allows_tolerance" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "measurement_units" SET "allows_tolerance" = "is_weight"`,
    );
    await queryRunner.query(
      `ALTER TABLE "measurement_units" ADD "odoo_unit_id" integer`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."measurement_units_odoo_sync_status_enum" AS ENUM('PENDING', 'SYNCED', 'FAILED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "measurement_units" ADD "odoo_sync_status" "public"."measurement_units_odoo_sync_status_enum" NOT NULL DEFAULT 'PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "measurement_units" DROP COLUMN "odoo_sync_status"`);
    await queryRunner.query(`DROP TYPE "public"."measurement_units_odoo_sync_status_enum"`);
    await queryRunner.query(`ALTER TABLE "measurement_units" DROP COLUMN "odoo_unit_id"`);
    await queryRunner.query(`ALTER TABLE "measurement_units" DROP COLUMN "allows_tolerance"`);
  }
}
