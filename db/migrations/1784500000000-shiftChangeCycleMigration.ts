import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Driver shift-change cycle v2 + fleet-scope mirrors + truck problems:
 *
 * - shifts.odoo_warehouse_id: the Odoo warehouse a shift belongs to (shifts
 *   are authored in Odoo, optionally scoped to one warehouse) — the driver
 *   may only request shifts of HIS OWN warehouse.
 * - collector_profiles.warehouse_id: the warehouse the Odoo admin assigned
 *   the driver to on acceptance (sent back through the driver-decision
 *   webhook as warehouse_odoo_id and resolved to the local mirror row).
 * - shift_change_requests: the driver no longer picks a truck (the manager
 *   does, on approval) → truck_id becomes optional; the request instead
 *   carries a mandatory `reason`.
 * - truck_problems: a driver's free-text problem report (+ photo URLs),
 *   mirrored to Odoo where the warehouse manager reads it.
 */
export class ShiftChangeCycleMigration1784500000000 implements MigrationInterface {
  name = 'ShiftChangeCycleMigration1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD "odoo_warehouse_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "collector_profiles" ADD "warehouse_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "collector_profiles" ADD CONSTRAINT "FK_collector_profiles_warehouse" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shift_change_requests" ADD "reason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "shift_change_requests" ALTER COLUMN "truck_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "truck_problems" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "odoo_problem_id" integer,
        "driver_id" uuid NOT NULL,
        "reason" text NOT NULL,
        "images" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_truck_problems_odoo_problem_id" UNIQUE ("odoo_problem_id"),
        CONSTRAINT "PK_truck_problems" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "truck_problems" ADD CONSTRAINT "FK_truck_problems_driver" FOREIGN KEY ("driver_id") REFERENCES "collector_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_truck_problems_driver_id" ON "truck_problems" ("driver_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_truck_problems_driver_id"`);
    await queryRunner.query(
      `ALTER TABLE "truck_problems" DROP CONSTRAINT "FK_truck_problems_driver"`,
    );
    await queryRunner.query(`DROP TABLE "truck_problems"`);
    await queryRunner.query(
      `ALTER TABLE "shift_change_requests" ALTER COLUMN "truck_id" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP COLUMN "reason"`);
    await queryRunner.query(
      `ALTER TABLE "collector_profiles" DROP CONSTRAINT "FK_collector_profiles_warehouse"`,
    );
    await queryRunner.query(`ALTER TABLE "collector_profiles" DROP COLUMN "warehouse_id"`);
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "odoo_warehouse_id"`);
  }
}
