import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidation: a split PICKUP order can be gathered into the ONE warehouse
 * nearest the buyer, so they collect everything from a single place instead of
 * driving to every warehouse the order was split across.
 *
 * Adds:
 *  - the order status CONSOLIDATING (a delivery truck is gathering the far
 *    parts into the nearest warehouse — shown to the buyer while it runs);
 *  - `consolidate` — the buyer's post-allocation choice to gather;
 *  - `consolidation_warehouse_id` — the gathering point (the order's warehouse
 *    nearest the buyer; its own part stays put).
 *
 * Adding the enum value without using it in the same migration is accepted
 * inside a transaction on Postgres 12+, which is what the stack runs.
 */
export class OrderConsolidationMigration1788900000000 implements MigrationInterface {
  name = 'OrderConsolidationMigration1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "orders_status_enum" ADD VALUE IF NOT EXISTS 'CONSOLIDATING'`,
    );
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "consolidate" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "consolidation_warehouse_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "consolidation_warehouse_id",
        DROP COLUMN IF EXISTS "consolidate"
    `);
    // Postgres cannot drop a single enum value; leaving CONSOLIDATING in place is
    // harmless once no row references it, and recreating the type is not worth the
    // risk here.
  }
}
