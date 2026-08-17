import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist WHERE a truck-handover session started and ended.
 *
 * The pickup/dropoff TIMES were already stored; their COORDINATES were not — the
 * live trail lived only in Redis and expired. Adds the four columns so "where
 * and when did this driver start and hand back the truck?" always answers from
 * the database. The driver app sends the GPS with the pickup / dropoff button;
 * columns are nullable because an app with no fix yet still completes a handover.
 */
export class HandoverCoordinatesMigration1788800000000 implements MigrationInterface {
  name = 'HandoverCoordinatesMigration1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "truck_handovers"
        ADD COLUMN IF NOT EXISTS "pickup_lat"  numeric(10,7),
        ADD COLUMN IF NOT EXISTS "pickup_lng"  numeric(10,7),
        ADD COLUMN IF NOT EXISTS "dropoff_lat" numeric(10,7),
        ADD COLUMN IF NOT EXISTS "dropoff_lng" numeric(10,7)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "truck_handovers"
        DROP COLUMN IF EXISTS "pickup_lat",
        DROP COLUMN IF EXISTS "pickup_lng",
        DROP COLUMN IF EXISTS "dropoff_lat",
        DROP COLUMN IF EXISTS "dropoff_lng"
    `);
  }
}
