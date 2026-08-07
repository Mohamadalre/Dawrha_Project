import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the redundant `is_active` boolean from `warehouses`.
 *
 * A warehouse's lifecycle is owned by `state` (ACTIVE / CLOSING / INACTIVE),
 * mirrored from Odoo — the second flag was one more thing to keep in step, and
 * it drifted. Everything that read `is_active` now reads `state`: "operational"
 * is `state != 'INACTIVE'`, "closed" is `state = 'INACTIVE'`.
 *
 * The two are already consistent in existing data (a warehouse is only stopped
 * from Odoo, which sets both), so no data backfill is needed before the drop.
 */
export class WarehouseDropIsActiveMigration1787500000000
  implements MigrationInterface
{
  name = 'WarehouseDropIsActiveMigration1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "is_active"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD COLUMN "is_active" boolean NOT NULL DEFAULT true`,
    );
    // Re-derive the restored flag from the surviving lifecycle state.
    await queryRunner.query(
      `UPDATE "warehouses" SET "is_active" = ("state" <> 'INACTIVE')`,
    );
  }
}
