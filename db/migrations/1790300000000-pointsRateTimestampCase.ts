import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrective: some databases got `points_rates` from an early TypeORM
 * `synchronize` pass that created its timestamps as camelCase
 * (`"createdAt"` / `"updatedAt"`), while the rest of the schema — and the
 * runtime naming strategy — use snake_case (`created_at` / `updated_at`).
 *
 * The mismatch made EVERY query against the entity fail with
 * `column PointsRate.created_at does not exist`, so the whole points-rate
 * admin API (set/read the money-per-point conversion) was dead. This renames
 * the columns to snake_case, but only if the camelCase form is what exists —
 * so it is a no-op on databases the migration built correctly.
 */
export class PointsRateTimestampCase1790300000000
  implements MigrationInterface
{
  name = 'PointsRateTimestampCase1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'points_rates' AND column_name = 'createdAt'
        ) THEN
          ALTER TABLE "points_rates" RENAME COLUMN "createdAt" TO "created_at";
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'points_rates' AND column_name = 'updatedAt'
        ) THEN
          ALTER TABLE "points_rates" RENAME COLUMN "updatedAt" TO "updated_at";
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse only if the snake_case form is present, so this is equally safe.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'points_rates' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE "points_rates" RENAME COLUMN "created_at" TO "createdAt";
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'points_rates' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE "points_rates" RENAME COLUMN "updated_at" TO "updatedAt";
        END IF;
      END $$;
    `);
  }
}
