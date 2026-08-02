import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shift scope mirror: a shift is GLOBAL (all warehouses) or SPECIFIC to one or
 * more warehouses — replacing the old single odoo_warehouse_id.
 *
 * - shifts.is_global: TRUE = appears for every warehouse (the only shifts a
 *   not-yet-accepted driver can pick during onboarding).
 * - shifts.odoo_warehouse_ids: int[] of the Odoo warehouse ids a specific shift
 *   belongs to (empty for a global shift).
 *
 * Backfill from the old single column: a NULL odoo_warehouse_id meant "global";
 * a set one meant "specific to that warehouse".
 */
export class ShiftScopeMigration1784700000000 implements MigrationInterface {
  name = 'ShiftScopeMigration1784700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD "is_global" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD "odoo_warehouse_ids" integer array NOT NULL DEFAULT '{}'`,
    );
    // Backfill: no warehouse → global; a warehouse → specific to it.
    await queryRunner.query(
      `UPDATE "shifts" SET "is_global" = ("odoo_warehouse_id" IS NULL)`,
    );
    await queryRunner.query(
      `UPDATE "shifts"
          SET "odoo_warehouse_ids" = ARRAY["odoo_warehouse_id"]
        WHERE "odoo_warehouse_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "odoo_warehouse_ids"`);
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "is_global"`);
  }
}
