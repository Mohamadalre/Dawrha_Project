import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Truck handover (pickup / dropoff) custody sessions + shift tolerance mirror.
 *
 * - shifts.tolerance: grace minutes mirrored from Odoo (recycle.shift.tolerance),
 *   used by the handover crons to decide "missed pickup" / "late dropoff".
 * - truck_handovers: one custody session per (driver, shift, day) — pickup and
 *   dropoff timestamps, dropoff notes, lateness, and once-only notification
 *   guards. Mirrored to Odoo for the manager's read-only "Driver Attendance".
 */
export class TruckHandoverMigration1784600000000 implements MigrationInterface {
  name = 'TruckHandoverMigration1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD "tolerance" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."truck_handovers_status_enum" AS ENUM('open', 'closed', 'missed_pickup')`,
    );
    await queryRunner.query(
      `CREATE TABLE "truck_handovers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "odoo_handover_id" integer,
        "driver_id" uuid NOT NULL,
        "truck_id" uuid NOT NULL,
        "shift_id" uuid NOT NULL,
        "warehouse_id" uuid,
        "work_date" date NOT NULL,
        "picked_up_at" TIMESTAMP WITH TIME ZONE,
        "dropped_off_at" TIMESTAMP WITH TIME ZONE,
        "dropoff_reason" text,
        "late_dropoff_minutes" integer,
        "status" "public"."truck_handovers_status_enum" NOT NULL DEFAULT 'open',
        "missed_pickup_notified_at" TIMESTAMP WITH TIME ZONE,
        "late_dropoff_notified_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_truck_handovers_odoo_id" UNIQUE ("odoo_handover_id"),
        CONSTRAINT "UQ_truck_handovers_driver_shift_day" UNIQUE ("driver_id", "shift_id", "work_date"),
        CONSTRAINT "PK_truck_handovers" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_truck_handovers_truck_status" ON "truck_handovers" ("truck_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "truck_handovers" ADD CONSTRAINT "FK_truck_handovers_driver" FOREIGN KEY ("driver_id") REFERENCES "collector_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "truck_handovers" ADD CONSTRAINT "FK_truck_handovers_truck" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "truck_handovers" ADD CONSTRAINT "FK_truck_handovers_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "truck_handovers" ADD CONSTRAINT "FK_truck_handovers_warehouse" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "truck_handovers" DROP CONSTRAINT "FK_truck_handovers_warehouse"`);
    await queryRunner.query(`ALTER TABLE "truck_handovers" DROP CONSTRAINT "FK_truck_handovers_shift"`);
    await queryRunner.query(`ALTER TABLE "truck_handovers" DROP CONSTRAINT "FK_truck_handovers_truck"`);
    await queryRunner.query(`ALTER TABLE "truck_handovers" DROP CONSTRAINT "FK_truck_handovers_driver"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_truck_handovers_truck_status"`);
    await queryRunner.query(`DROP TABLE "truck_handovers"`);
    await queryRunner.query(`DROP TYPE "public"."truck_handovers_status_enum"`);
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "tolerance"`);
  }
}
