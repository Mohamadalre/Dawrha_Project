import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A product suggestion stops being something only an app account can make.
 *
 * The Odoo administrator no longer creates materials directly — they propose
 * one, and the proposal lands in the same review queue as a buyer's. That
 * person has no account in this backend, so `account_id` becomes nullable and a
 * `source` column says which side a row came from. Without the column an
 * Odoo-authored row would be indistinguishable from a buyer's except by a NULL,
 * and "NULL means Odoo" is exactly the kind of implicit rule that breaks the
 * first time someone deletes an account.
 *
 * `odoo_suggestion_id` is UNIQUE so the push is idempotent: Odoo retrying after
 * a timeout must not create a second copy of the same proposal.
 */
export class SuggestionSourceMigration1785500000000 implements MigrationInterface {
  name = 'SuggestionSourceMigration1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "product_suggestions_source_enum" AS ENUM ('APP', 'ODOO')
    `);
    await queryRunner.query(`
      ALTER TABLE "product_suggestions"
        ADD "source" "product_suggestions_source_enum" NOT NULL DEFAULT 'APP'
    `);
    await queryRunner.query(`
      ALTER TABLE "product_suggestions" ADD "odoo_suggestion_id" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "product_suggestions" ADD "suggested_by_name" character varying(150)
    `);
    await queryRunner.query(`
      ALTER TABLE "product_suggestions" ALTER COLUMN "account_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_product_suggestions_odoo_id"
        ON "product_suggestions" ("odoo_suggestion_id")
        WHERE "odoo_suggestion_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_product_suggestions_source"
        ON "product_suggestions" ("source")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_product_suggestions_source"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_product_suggestions_odoo_id"`);
    // Rows without an account cannot survive the NOT NULL coming back; they are
    // Odoo-authored proposals and belong to no account by construction.
    await queryRunner.query(
      `DELETE FROM "product_suggestions" WHERE "account_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" ALTER COLUMN "account_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" DROP COLUMN "suggested_by_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" DROP COLUMN "odoo_suggestion_id"`,
    );
    await queryRunner.query(`ALTER TABLE "product_suggestions" DROP COLUMN "source"`);
    await queryRunner.query(`DROP TYPE "product_suggestions_source_enum"`);
  }
}
