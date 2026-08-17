import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `min_charge` from `delivery_rates`.
 *
 * The floor on a single delivery was removed: the backend administrator now
 * authors only a base fee and a per-kilometre rate, and a quote is exactly
 * `base_fee + distance × rate_per_km`. The column is dropped rather than kept
 * unused so no later reader mistakes a stale value for a live setting.
 */
export class DropDeliveryRateMinChargeMigration1788700000000 implements MigrationInterface {
  name = 'DropDeliveryRateMinChargeMigration1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_rates" DROP COLUMN IF EXISTS "min_charge"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_rates" ADD COLUMN "min_charge" numeric(12,3) NOT NULL DEFAULT 0`,
    );
  }
}
