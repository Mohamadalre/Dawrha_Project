import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds soft-archive columns to `accounts`.
 *
 * "Delete an account" ARCHIVES it rather than dropping the row: the row stays
 * (so its email and phone remain claimed and the same person cannot silently
 * re-register on them — the rule Odoo enforces through its identity registry),
 * its related data is preserved for audit, and every entry path treats it as
 * gone — login answers "account not found" and any existing token stops working
 * on every route.
 *
 * `archived_at` is the marker (null = live). `archived_by` records which admin
 * did it. A partial index keeps the common "live accounts only" queries fast.
 */
export class AccountArchiveMigration1787700000000 implements MigrationInterface {
  name = 'AccountArchiveMigration1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "archived_by" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_accounts_archived_at" ON "accounts" ("archived_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_archived_at"`);
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "archived_by"`);
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "archived_at"`);
  }
}
