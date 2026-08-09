import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `stages` — the points bands users are classified into.
 *
 * Each stage has a name, an optional image, a manual order (`sort_order`, kept a
 * contiguous 1..N sequence by the service), and an inclusive points range
 * `[min_points, max_points]`. A user's wallet balance decides which stage they
 * are in; the service keeps ranges non-overlapping so that answer is unique.
 */
export class StagesMigration1787900000000 implements MigrationInterface {
  name = 'StagesMigration1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "image_url" character varying,
        "sort_order" integer NOT NULL,
        "min_points" integer NOT NULL,
        "max_points" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stages_sort_order" ON "stages" ("sort_order")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stages_points" ON "stages" ("min_points", "max_points")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "stages"`);
  }
}
