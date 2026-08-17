import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-account response language.
 *
 * Once set in settings, every API response comes back in this language without
 * the client sending any header. Existing accounts default to English.
 */
export class AccountLanguageMigration1788600000000 implements MigrationInterface {
  name = 'AccountLanguageMigration1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
         CREATE TYPE "accounts_language_enum" AS ENUM('en', 'ar');
       EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "language" "accounts_language_enum" NOT NULL DEFAULT 'en'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "language"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "accounts_language_enum"`);
  }
}
