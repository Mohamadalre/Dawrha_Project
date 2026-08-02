import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Read-only mirror of Odoo's `recycle.delivery.tariff`.
 *
 * The Odoo administrator authors delivery pricing — Odoo owns the fleet, so it
 * owns what a delivery costs. This table exists so a buyer's cart can be quoted
 * from a plain database read: a price shown before the buyer commits must not
 * depend on Odoo being reachable at that instant.
 *
 * `odoo_tariff_id` is UNIQUE and is the match key, so re-running the sync
 * updates rows in place instead of duplicating them.
 */
export class DeliveryTariffMirrorMigration1784900000000
  implements MigrationInterface
{
  name = 'DeliveryTariffMirrorMigration1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "delivery_tariffs_scope_enum" AS ENUM('WAREHOUSE', 'PROVINCE', 'GLOBAL')`,
    );
    await queryRunner.query(`
      CREATE TABLE "delivery_tariffs" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "odoo_tariff_id" integer NOT NULL,
        "scope"          "delivery_tariffs_scope_enum" NOT NULL,
        "warehouse_id"   uuid,
        "province_id"    uuid,
        "base_fee"       numeric(12,3) NOT NULL DEFAULT 0,
        "rate_per_km"    numeric(12,3) NOT NULL DEFAULT 0,
        "min_fee"        numeric(12,3) NOT NULL DEFAULT 0,
        "currency"       character varying NOT NULL DEFAULT 'JOD',
        "is_active"      boolean NOT NULL DEFAULT true,
        "synced_at"      TIMESTAMP WITH TIME ZONE,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_delivery_tariffs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_delivery_tariffs_odoo_id" ON "delivery_tariffs" ("odoo_tariff_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_delivery_tariffs_warehouse" ON "delivery_tariffs" ("warehouse_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_delivery_tariffs_province" ON "delivery_tariffs" ("province_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_tariffs" ADD CONSTRAINT "FK_delivery_tariffs_warehouse"
         FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_tariffs" ADD CONSTRAINT "FK_delivery_tariffs_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "delivery_tariffs"`);
    await queryRunner.query(`DROP TYPE "delivery_tariffs_scope_enum"`);
  }
}
