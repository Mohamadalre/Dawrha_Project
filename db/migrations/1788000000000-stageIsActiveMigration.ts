import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `is_active` to `stages`.
 *
 * An inactive stage keeps its order but classifies no one — the user route only
 * ever matches an ACTIVE stage. Existing rows default to active.
 */
export class StageIsActiveMigration1788000000000 implements MigrationInterface {
  name = 'StageIsActiveMigration1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stages" DROP COLUMN IF EXISTS "is_active"`);
  }
}
