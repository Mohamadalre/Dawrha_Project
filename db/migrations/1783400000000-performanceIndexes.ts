import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes behind the three most-repeated filtered reads.
 *
 * RECONSTRUCTED. This migration's row exists in the `migrations` table of the
 * development database, but its FILE had gone missing — so the indexes existed
 * here and nowhere else. A fresh database (a teammate's, staging, production)
 * would have been built without them and would have behaved differently from
 * this one, in the worst possible way: not as an error, but as pages that get
 * slower as the tables grow, which is discovered as "the app feels slow" rather
 * than as anything anyone can point at.
 *
 * The three were read back out of the live database — they are the only indexes
 * present that no other migration file creates — so this file now says exactly
 * what that database already has.
 *
 * IF NOT EXISTS throughout: this migration is already recorded as run here, but
 * a database that has the indexes without the row (a restored dump, a manual
 * fix) must not fail on the way in.
 *
 *   accounts.account_status        — every admin review queue filters on it
 *   media.owner_id                 — a profile's documents are fetched by owner
 *   notifications(user_id,is_read) — the unread badge, polled by every client
 */
export class PerformanceIndexes1783400000000 implements MigrationInterface {
  name = 'PerformanceIndexes1783400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_accounts_account_status"
        ON "accounts" ("account_status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_media_owner_id"
        ON "media" ("owner_id")
    `);
    // Composite and in this order: the query is always "this user's unread",
    // so user_id must lead — an index on is_read alone would be read past on
    // every row of every other user.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_user_is_read"
        ON "notifications" ("user_id", "is_read")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_user_is_read"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_media_owner_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_account_status"`);
  }
}
