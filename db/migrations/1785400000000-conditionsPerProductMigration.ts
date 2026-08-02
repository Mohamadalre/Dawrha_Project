import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grades stop being a global vocabulary and become a property of each material.
 *
 * The old shape had ONE list every material had to borrow from. That is wrong
 * in the domain: the grades that describe scrap paper say nothing useful about
 * copper, and pricing then had to carry rows for grades a material cannot
 * actually be in. It also made "this material has no grades" impossible to
 * express, when that is a normal, common answer.
 *
 * Migration strategy — no data is invented:
 *   Every existing global grade is COPIED onto each product that already has a
 *   price row referencing it. A product priced per grade keeps exactly the
 *   grades it was priced for; a product never priced per grade ends up
 *   ungraded, which is the honest reading of "nobody ever graded it".
 *   The old global rows are then removed.
 */
export class ConditionsPerProductMigration1785400000000
  implements MigrationInterface
{
  name = 'ConditionsPerProductMigration1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "material_conditions" ADD "product_id" uuid`,
    );

    // Copy each global grade onto the products actually priced with it.
    await queryRunner.query(`
      INSERT INTO "material_conditions"
             ("product_id", "code", "name_en", "name_ar", "sort_order",
              "is_active", "odoo_sync_status", "created_at", "updated_at")
      SELECT DISTINCT pp."product_id", mc."code", mc."name_en", mc."name_ar",
             mc."sort_order", mc."is_active",
             'PENDING'::"material_conditions_odoo_sync_status_enum", now(), now()
        FROM "product_pricing" pp
        JOIN "material_conditions" mc ON mc."code" = pp."condition_code"
       WHERE pp."condition_code" IS NOT NULL
         AND mc."product_id" IS NULL
    `);

    // Drop what is left: the originals, which belonged to no material.
    await queryRunner.query(
      `DELETE FROM "material_conditions" WHERE "product_id" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "material_conditions" ALTER COLUMN "product_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_conditions" ADD CONSTRAINT "FK_conditions_product"
         FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conditions_product" ON "material_conditions" ("product_id")`,
    );

    // The code was globally unique; now it identifies a grade WITHIN a material,
    // so two materials may each have their own 'GOOD'.
    await queryRunner.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        SELECT tc.constraint_name INTO cname
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name
         WHERE tc.table_name = 'material_conditions'
           AND tc.constraint_type = 'UNIQUE'
           AND kcu.column_name = 'code'
         LIMIT 1;
        IF cname IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "material_conditions" DROP CONSTRAINT %I', cname);
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "material_conditions"
         ADD CONSTRAINT "UQ_condition_product_code" UNIQUE ("product_id", "code")`,
    );

    // Grade order is now per material, so renumber each material from 1.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT "id",
               ROW_NUMBER() OVER (PARTITION BY "product_id"
                                  ORDER BY "sort_order", "code") AS position
          FROM "material_conditions"
      )
      UPDATE "material_conditions" mc
         SET "sort_order" = ranked.position
        FROM ranked
       WHERE ranked."id" = mc."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "material_conditions" DROP CONSTRAINT "UQ_condition_product_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_conditions" DROP CONSTRAINT "FK_conditions_product"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_conditions_product"`);
    await queryRunner.query(
      `ALTER TABLE "material_conditions" DROP COLUMN "product_id"`,
    );
  }
}
