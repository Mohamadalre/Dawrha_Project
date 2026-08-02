import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two columns the order allocator cannot work without.
 *
 * 1. `warehouses.province_id` — a real FK into `provinces` (the same table Odoo
 *    mirrors as `recycle.province`). Until now the governorate lived only as
 *    free text, so "warehouses in the buyer's governorate" would have meant
 *    comparing display names — which breaks the moment a name is renamed or
 *    typed with a different spacing. Backfilled from the existing name, in
 *    Arabic or English, case-insensitively.
 *
 * 2. `warehouses.state` — the lifecycle Odoo owns (active / closing /
 *    inactive). Allocation may only choose ACTIVE warehouses: routing a new
 *    order into one that is winding down is exactly what the closing state
 *    exists to prevent. Every existing row starts ACTIVE and the next
 *    SYNC_WAREHOUSE corrects it from Odoo.
 */
export class WarehouseProvinceAndStateMigration1784800000000
  implements MigrationInterface
{
  name = 'WarehouseProvinceAndStateMigration1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "warehouses_state_enum" AS ENUM('ACTIVE', 'CLOSING', 'INACTIVE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD "state" "warehouses_state_enum" NOT NULL DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD "province_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD CONSTRAINT "FK_warehouses_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id")
         ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_warehouses_province" ON "warehouses" ("province_id")`,
    );

    // Backfill from the governorate name as it was typed — either language.
    await queryRunner.query(
      `UPDATE "warehouses" w
          SET "province_id" = p."id"
         FROM "provinces" p
        WHERE w."province_id" IS NULL
          AND w."governorate" IS NOT NULL
          AND (lower(btrim(w."governorate")) = lower(p."name_ar")
            OR lower(btrim(w."governorate")) = lower(p."name_en"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_warehouses_province"`);
    await queryRunner.query(
      `ALTER TABLE "warehouses" DROP CONSTRAINT "FK_warehouses_province"`,
    );
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN "province_id"`);
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN "state"`);
    await queryRunner.query(`DROP TYPE "warehouses_state_enum"`);
  }
}
