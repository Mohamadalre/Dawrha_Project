import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collapse the institution's two phone columns into one, holding a MOBILE.
 *
 * `FacilityMobileMigration1785900000000` added `institution_mobile` beside the
 * landline, reasoning that "a public body genuinely has a switchboard worth
 * recording". In use that reasoning does not hold up: two columns for one
 * answer are two places to look, and one of them is always the wrong one. The
 * number that matters is the one a driver at a locked gate can ring, and the
 * switchboard is not it outside office hours — so every consumer had to know
 * to prefer the mobile and fall back, and any that forgot rang the building.
 *
 * Free facilities were already collapsed to a single mobile column for exactly
 * this reason. This brings institutions in line: one column, not two.
 *
 * The mobile WINS where both exist, because it is the one the DTO has required
 * from every applicant since it was added, and the one the platform actually
 * dials.
 *
 * Rows holding only a landline keep it. There is no mobile to move into place
 * for them and none may be invented — a fabricated contact number is worse
 * than a stale one, because it looks callable. They are corrected the next time
 * the institution edits its information, which the edit route now validates as
 * a Syrian mobile.
 *
 * Column names are snake_case: this project maps entity properties through
 * SnakeNamingStrategy, so `institutionMobile` is `institution_mobile` on disk.
 * Writing the property name produces a migration that fails only when run.
 */
export class InstitutionSinglePhoneMigration1786500000000
  implements MigrationInterface
{
  name = 'InstitutionSinglePhoneMigration1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Move the mobile into the surviving column. Guarded against a collision
    // with a DIFFERENT row's phone: the column is unique, and a copy that
    // violates it would abort the migration halfway. In practice the two
    // formats cannot collide (`011…` against `9639…`), but "in practice" is not
    // a constraint the database enforces.
    await queryRunner.query(`
      UPDATE "institution_profiles" AS t
         SET "institution_phone" = t."institution_mobile"
       WHERE t."institution_mobile" IS NOT NULL
         AND t."institution_mobile" <> t."institution_phone"
         AND NOT EXISTS (
           SELECT 1 FROM "institution_profiles" o
            WHERE o."id" <> t."id"
              AND o."institution_phone" = t."institution_mobile"
         )
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_institution_mobile"`);
    await queryRunner.query(`
      ALTER TABLE "institution_profiles"
        DROP COLUMN IF EXISTS "institution_mobile"
    `);
  }

  /**
   * Restores the column and the index, not the data.
   *
   * Which mobile belonged to which row is exactly what the `up` threw away by
   * merging the two, and a `down` that guessed would put a landline back in
   * the mobile column. Reversing the schema is honest; reversing the merge is
   * not something this migration is able to do.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "institution_profiles"
        ADD COLUMN IF NOT EXISTS "institution_mobile" character varying
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_institution_mobile"
        ON "institution_profiles" ("institution_mobile")
        WHERE "institution_mobile" IS NOT NULL
    `);
  }
}
