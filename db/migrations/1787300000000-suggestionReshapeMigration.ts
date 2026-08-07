import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reshapes product_suggestions to the new model: a suggestion is a material
 * NAME + a CATEGORY + one or more IMAGES. It no longer carries a unit or an
 * estimated price, and a single image URL becomes an array of them.
 *
 * The status column stays (the admin no longer approves/rejects — they reply —
 * but the column is harmless bookkeeping and dropping an enum is more churn than
 * it is worth). admin_notes / reviewed_by / reviewed_at are reused as the reply
 * fields, so they are left in place.
 */
export class SuggestionReshapeMigration1787300000000
  implements MigrationInterface
{
  name = 'SuggestionReshapeMigration1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" ADD COLUMN "image_urls" jsonb`,
    );
    // Carry any existing single image forward as a one-element array.
    await queryRunner.query(
      `UPDATE "product_suggestions" SET "image_urls" = to_jsonb(ARRAY["image_url"]) WHERE "image_url" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" DROP COLUMN IF EXISTS "image_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" DROP COLUMN IF EXISTS "unit_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" DROP COLUMN IF EXISTS "estimated_price"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" ADD COLUMN "unit_type" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" ADD COLUMN "estimated_price" numeric(12,3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" ADD COLUMN "image_url" character varying`,
    );
    // Restore the first image, if any, into the old single-URL column.
    await queryRunner.query(
      `UPDATE "product_suggestions" SET "image_url" = ("image_urls"->>0) WHERE "image_urls" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" DROP COLUMN IF EXISTS "image_urls"`,
    );
  }
}
