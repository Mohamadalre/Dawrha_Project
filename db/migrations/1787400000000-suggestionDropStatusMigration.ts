import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the suggestion STATUS entirely. The admin no longer approves or rejects
 * a proposal — they read it and may reply — so there is no lifecycle to record.
 *
 * Also drops the now-orphaned unit-type enum left behind when the unit column
 * was removed (the column went in the previous migration; its enum type did
 * not, so it is cleaned up here).
 */
export class SuggestionDropStatusMigration1787400000000
  implements MigrationInterface
{
  name = 'SuggestionDropStatusMigration1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" DROP COLUMN IF EXISTS "status"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."product_suggestions_status_enum"`,
    );
    // Orphaned by the previous migration's unit_type column drop.
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."product_suggestions_unit_type_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."product_suggestions_status_enum" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_suggestions" ADD COLUMN "status" "public"."product_suggestions_status_enum" NOT NULL DEFAULT 'PENDING_REVIEW'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."product_suggestions_unit_type_enum" AS ENUM('PIECE', 'KG')`,
    );
  }
}
