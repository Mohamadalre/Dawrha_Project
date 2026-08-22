import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make shipments.warehouse_id nullable — shipments are now auto-created when
 * the driver accepts the first request, before any warehouse is known.
 * The warehouse is resolved later from the driver's active truck handover.
 */
export class ShipmentWarehouseNullable1789710000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing FK (RESTRICT), alter column to nullable, re-add FK as SET NULL
    await queryRunner.query(`
      ALTER TABLE "shipments"
      DROP CONSTRAINT "FK_shipments_warehouse"
    `);
    await queryRunner.query(`
      ALTER TABLE "shipments"
      ALTER COLUMN "warehouse_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "shipments"
      ADD CONSTRAINT "FK_shipments_warehouse"
      FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id")
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipments"
      DROP CONSTRAINT "FK_shipments_warehouse"
    `);
    await queryRunner.query(`
      ALTER TABLE "shipments"
      ALTER COLUMN "warehouse_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "shipments"
      ADD CONSTRAINT "FK_shipments_warehouse"
      FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id")
      ON DELETE RESTRICT
    `);
  }
}
