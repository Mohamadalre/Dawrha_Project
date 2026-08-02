import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Column names are snake_case: this project maps entity properties through
 * SnakeNamingStrategy, so `institutionMobile` is `institution_mobile` on disk.
 * Writing the property name produces a migration that fails only when run.
 *
 * Give institutions a MOBILE number, not just a landline.
 *
 * Factories were asked for one at onboarding; institutions were asked only for
 * a landline. A landline reaches the premises during office hours; a driver
 * standing at a locked gate with a pallet on the truck needs the number of
 * somebody who will pick up.
 *
 * Free facilities are NOT here: their single phone column has been changed to
 * hold the mobile outright, so they need no second column. Institutions keep
 * both because a public body genuinely has a switchboard worth recording.
 *
 * Nullable, and deliberately so. The DTO requires it from every new applicant;
 * the column cannot, because rows created before this existed have no mobile to
 * backfill and nothing may be invented for them. A fake contact number is worse
 * than a missing one — it looks like something a driver can call.
 */
export class FacilityMobileMigration1785900000000 implements MigrationInterface {
  name = 'FacilityMobileMigration1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "institution_profiles"
        ADD COLUMN IF NOT EXISTS "institution_mobile" character varying
    `);

    // Partial: NULLs are expected and many, and a plain unique index would be
    // satisfied by them anyway — this states the intent and stays small.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_institution_mobile"
        ON "institution_profiles" ("institution_mobile")
        WHERE "institution_mobile" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_institution_mobile"`);
    await queryRunner.query(`
      ALTER TABLE "institution_profiles"
        DROP COLUMN IF EXISTS "institution_mobile"
    `);
  }
}
