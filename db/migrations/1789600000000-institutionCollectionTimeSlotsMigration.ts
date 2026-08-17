import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An institution's `preferred_collection_time` becomes a structured slot list —
 * a jsonb array of `{ day, from, to }` — instead of a `text[]` of free strings,
 * matching the detailed windows factories already use.
 *
 * The old free-text values cannot be mapped to a weekday + time window, so they
 * are dropped (set to NULL) rather than mangled; these are onboarding drafts and
 * the applicant re-enters the windows in the new shape.
 */
export class InstitutionCollectionTimeSlotsMigration1789600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "institution_materials" ALTER COLUMN "preferred_collection_time" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "institution_materials"
         ALTER COLUMN "preferred_collection_time" TYPE jsonb USING NULL::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "institution_materials"
         ALTER COLUMN "preferred_collection_time" TYPE text[] USING NULL::text[]`,
    );
  }
}
