import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Material conditions (grades) + per-condition pricing/stock:
 * 1) New `material_conditions` table — admin-managed grades (EXCELLENT/GOOD/
 *    POOR/DAMAGED seeded by db/seeds/condition-seed.ts, run `npm run seed`).
 *    Mirrored to Odoo (SYNC_CONDITION job) for the sorting UI.
 * 2) `warehouse_inventory` becomes per-(product, condition): the Odoo sorter
 *    grades every processed quantity. Existing rows land under UNGRADED.
 * 3) `product_pricing` / `product_pricing_history` / `cart_items` gain a
 *    nullable `condition_code`: FACTORY / FREE_FACILITY tiers are priced per
 *    condition; INDIVIDUAL / COMPANY stay product-wide (null).
 * 4) Composite index for the notifications list query (approved fix).
 */
export class MaterialConditionsMigration1783300000000 implements MigrationInterface {
  name = 'MaterialConditionsMigration1783300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) conditions table
    await queryRunner.query(
      `CREATE TYPE "public"."material_conditions_odoo_sync_status_enum" AS ENUM('PENDING', 'SYNCED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "material_conditions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(30) NOT NULL,
        "name_en" character varying(100) NOT NULL,
        "name_ar" character varying(100) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT '0',
        "is_active" boolean NOT NULL DEFAULT true,
        "odoo_condition_id" integer,
        "odoo_sync_status" "public"."material_conditions_odoo_sync_status_enum" NOT NULL DEFAULT 'PENDING',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_material_conditions_code" UNIQUE ("code"),
        CONSTRAINT "PK_material_conditions" PRIMARY KEY ("id")
      )`,
    );

    // 2) inventory rows per (warehouse, product, condition)
    await queryRunner.query(
      `ALTER TABLE "warehouse_inventory" ADD "condition_code" character varying(30) NOT NULL DEFAULT 'UNGRADED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouse_inventory" DROP CONSTRAINT "UQ_9c98ad33a2e6e3d2bfb9cb8c07c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouse_inventory" ADD CONSTRAINT "UQ_warehouse_inventory_product_condition" UNIQUE ("warehouse_id", "odoo_product_id", "condition_code")`,
    );

    // 3) per-condition pricing + cart snapshots
    await queryRunner.query(
      `ALTER TABLE "product_pricing" ADD "condition_code" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_pricing_history" ADD "condition_code" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ADD "condition_code" character varying(30)`,
    );

    // 4) notifications list query index (user_id, is_read, created_at)
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_user_read_created" ON "notifications" ("user_id", "is_read", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_notifications_user_read_created"`);
    await queryRunner.query(`ALTER TABLE "cart_items" DROP COLUMN "condition_code"`);
    await queryRunner.query(`ALTER TABLE "product_pricing_history" DROP COLUMN "condition_code"`);
    await queryRunner.query(`ALTER TABLE "product_pricing" DROP COLUMN "condition_code"`);
    await queryRunner.query(
      `ALTER TABLE "warehouse_inventory" DROP CONSTRAINT "UQ_warehouse_inventory_product_condition"`,
    );
    // Collapse per-condition rows before restoring the old uniqueness.
    await queryRunner.query(
      `DELETE FROM "warehouse_inventory" a USING "warehouse_inventory" b
        WHERE a.ctid < b.ctid
          AND a."warehouse_id" = b."warehouse_id"
          AND a."odoo_product_id" = b."odoo_product_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouse_inventory" ADD CONSTRAINT "UQ_9c98ad33a2e6e3d2bfb9cb8c07c" UNIQUE ("warehouse_id", "odoo_product_id")`,
    );
    await queryRunner.query(`ALTER TABLE "warehouse_inventory" DROP COLUMN "condition_code"`);
    await queryRunner.query(`DROP TABLE "material_conditions"`);
    await queryRunner.query(`DROP TYPE "public"."material_conditions_odoo_sync_status_enum"`);
  }
}
