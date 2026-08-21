import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A citizen can LABEL each of their saved locations — "Home", "Work" — so the
 * one they pick when placing an order is named, not a bare pin on a map.
 *
 * The label is unique PER CITIZEN, not globally: two people may both have a
 * "Home", but one person may not have two. A partial, case-insensitive unique
 * index enforces exactly that, and only over rows that HAVE a name — so the
 * onboarding location and every location created before this (name IS NULL)
 * are untouched and never collide.
 */
export class LocationNameMigration1789800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "name" character varying`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_location_profile_name"
         ON "locations" ("cititzen_profile_id", lower("name"))
         WHERE "name" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_location_profile_name"`);
    await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN IF EXISTS "name"`);
  }
}
