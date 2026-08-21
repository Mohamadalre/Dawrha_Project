import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline table for the leaderboard TREND (↑ up / ↓ down / = same).
 *
 * Points only ever rise, so a user falls only by being overtaken — a RANK
 * change. To show that, we need where each citizen stood at the last snapshot.
 * A daily cron upserts one row per active citizen (rank + points at that
 * moment); the live leaderboard compares the current rank to it. `account_id`
 * is unique so the upsert keeps exactly one baseline per user.
 */
export class LeaderboardSnapshotMigration1789900000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leaderboard_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL,
        "rank" integer NOT NULL,
        "points" integer NOT NULL,
        "taken_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leaderboard_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_leaderboard_snapshot_account"
        ON "leaderboard_snapshots" ("account_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_leaderboard_snapshot_account"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "leaderboard_snapshots"`);
  }
}
