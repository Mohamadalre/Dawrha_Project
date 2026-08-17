import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The single-row platform settings table, seeded with one row (default currency
 * 'SYP'). The UNIQUE `singleton` flag makes a second row impossible, so "the
 * settings" is always exactly one row.
 */
export class PlatformSettingsMigration1789500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "singleton" boolean NOT NULL DEFAULT true,
        "default_currency" character varying(8) NOT NULL DEFAULT 'SYP',
        "updated_by" character varying,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_platform_settings_singleton" UNIQUE ("singleton")
      )
    `);

    // Seed exactly one row (idempotent via the unique singleton flag).
    await queryRunner.query(`
      INSERT INTO "platform_settings" ("singleton", "default_currency")
      VALUES (true, 'SYP')
      ON CONFLICT ("singleton") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_settings"`);
  }
}
