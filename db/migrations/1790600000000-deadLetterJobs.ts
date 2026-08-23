import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable record of background sync jobs that failed permanently (exhausted
 * every retry). Pairs with the `SYNC_JOB_DEAD_LETTERED` ERROR-log alert: the
 * log tells operations something died; this table says exactly what, so it can
 * be inspected and re-driven by hand.
 */
export class DeadLetterJobs1790600000000 implements MigrationInterface {
  name = 'DeadLetterJobs1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dead_letter_jobs" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "queue"      character varying(120) NOT NULL,
        "job_id"     character varying(120),
        "job_name"   character varying(160) NOT NULL,
        "payload"    jsonb,
        "error"      text,
        "attempts"   integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dead_letter_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dead_letter_jobs_job_id" ON "dead_letter_jobs" ("job_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dead_letter_jobs_job_name" ON "dead_letter_jobs" ("job_name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "dead_letter_jobs"`);
  }
}
