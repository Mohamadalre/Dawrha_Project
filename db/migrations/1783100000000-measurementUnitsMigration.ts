import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dynamic measurement units:
 * 1) New `measurement_units` table (structure only — KG/PIECE rows are seeded
 *    by db/seeds/unit-seed.ts, run `npm run seed`).
 * 2) products / cart_items / product_suggestions `unit_type` columns switch
 *    from fixed PG enums to varchar(20) so admins can add new units without a
 *    schema change. Existing values ('KG' / 'PIECE') are preserved as-is.
 */
export class MeasurementUnitsMigration1783100000000 implements MigrationInterface {
  name = 'MeasurementUnitsMigration1783100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "measurement_units" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(20) NOT NULL,
        "name_en" character varying(100) NOT NULL,
        "name_ar" character varying(100) NOT NULL,
        "is_weight" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_measurement_units_code" UNIQUE ("code"),
        CONSTRAINT "PK_measurement_units" PRIMARY KEY ("id")
      )`,
    );

    // enum -> varchar (values preserved), then drop the now-unused PG enum types.
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "unit_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "unit_type" TYPE character varying(20) USING "unit_type"::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "unit_type" SET DEFAULT 'PIECE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ALTER COLUMN "unit_type" TYPE character varying(20) USING "unit_type"::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" ALTER COLUMN "unit_type" TYPE character varying(20) USING "unit_type"::text`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."products_unit_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."cart_items_unit_type_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."product_suggestions_unit_type_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."products_unit_type_enum" AS ENUM('PIECE', 'KG')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."cart_items_unit_type_enum" AS ENUM('PIECE', 'KG')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."product_suggestions_unit_type_enum" AS ENUM('PIECE', 'KG')`,
    );

    // Non-KG/PIECE codes cannot survive the downgrade — map them to PIECE.
    await queryRunner.query(
      `UPDATE "products" SET "unit_type" = 'PIECE' WHERE "unit_type" NOT IN ('PIECE', 'KG')`,
    );
    await queryRunner.query(
      `UPDATE "cart_items" SET "unit_type" = 'PIECE' WHERE "unit_type" NOT IN ('PIECE', 'KG')`,
    );
    await queryRunner.query(
      `UPDATE "product_suggestions" SET "unit_type" = 'PIECE' WHERE "unit_type" NOT IN ('PIECE', 'KG')`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "unit_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "unit_type" TYPE "public"."products_unit_type_enum" USING "unit_type"::"public"."products_unit_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ALTER COLUMN "unit_type" SET DEFAULT 'PIECE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ALTER COLUMN "unit_type" TYPE "public"."cart_items_unit_type_enum" USING "unit_type"::"public"."cart_items_unit_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" ALTER COLUMN "unit_type" TYPE "public"."product_suggestions_unit_type_enum" USING "unit_type"::"public"."product_suggestions_unit_type_enum"`,
    );

    await queryRunner.query(`DROP TABLE "measurement_units"`);
  }
}
