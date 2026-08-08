import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `points_wallets` — one wallet per ACTIVE buyer/seller account.
 *
 * A wallet holds a running `points` balance (starts at 0) that future order
 * flows will raise. One is created the moment an eligible account becomes
 * ACTIVE (citizen / institution / factory / free facility); admins and
 * collectors never get one. `account_id` is unique (one wallet per account) and
 * cascades on account delete so a removed account leaves no orphan behind.
 */
export class PointsWalletMigration1787600000000 implements MigrationInterface {
  name = 'PointsWalletMigration1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "points_wallets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL,
        "points" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_points_wallets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_points_wallets_account_id" UNIQUE ("account_id"),
        CONSTRAINT "FK_points_wallets_account" FOREIGN KEY ("account_id")
          REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // Backfill: every account that is ALREADY active and wallet-eligible gets an
    // empty wallet, so the feature is complete on deploy rather than only for
    // accounts activated afterwards. Ineligible roles (admin, collector) are
    // excluded. ON CONFLICT keeps the migration re-runnable.
    await queryRunner.query(`
      INSERT INTO "points_wallets" ("account_id", "points")
      SELECT "id", 0
      FROM "accounts"
      WHERE "account_status" = 'ACTIVE'
        AND "role" IN ('CITIZEN', 'INSTITUTIONS', 'FACTORY', 'EXTERNAL_PARTNER')
      ON CONFLICT ("account_id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "points_wallets"`);
  }
}
