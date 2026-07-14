import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fleet master moves to Odoo:
 * - trucks: mirrored FROM Odoo (odoo_truck_id) and linked to a warehouse.
 * - shifts: authored in Odoo (odoo_shift_id); backend keeps a read mirror.
 * - truck_assignments: driver-truck links are decided in Odoo (odoo_assignment_id).
 * - shift_change_requests: pushed to Odoo for the decision (odoo_request_id).
 */
export class FleetOdooMasterMigration1783400000000 implements MigrationInterface {
  name = 'FleetOdooMasterMigration1783400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trucks" ADD "odoo_truck_id" integer`);
    await queryRunner.query(`ALTER TABLE "trucks" ADD CONSTRAINT "UQ_trucks_odoo_truck_id" UNIQUE ("odoo_truck_id")`);
    await queryRunner.query(`ALTER TABLE "trucks" ADD "warehouse_id" uuid`);
    await queryRunner.query(`ALTER TABLE "trucks" ADD CONSTRAINT "FK_trucks_warehouse" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

    await queryRunner.query(`ALTER TABLE "shifts" ADD "odoo_shift_id" integer`);
    await queryRunner.query(`ALTER TABLE "shifts" ADD CONSTRAINT "UQ_shifts_odoo_shift_id" UNIQUE ("odoo_shift_id")`);

    await queryRunner.query(`ALTER TABLE "truck_assignments" ADD "odoo_assignment_id" integer`);
    await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "UQ_truck_assignments_odoo_id" UNIQUE ("odoo_assignment_id")`);

    await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD "odoo_request_id" integer`);
    await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "UQ_shift_change_requests_odoo_id" UNIQUE ("odoo_request_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "UQ_shift_change_requests_odoo_id"`);
    await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP COLUMN "odoo_request_id"`);
    await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "UQ_truck_assignments_odoo_id"`);
    await queryRunner.query(`ALTER TABLE "truck_assignments" DROP COLUMN "odoo_assignment_id"`);
    await queryRunner.query(`ALTER TABLE "shifts" DROP CONSTRAINT "UQ_shifts_odoo_shift_id"`);
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "odoo_shift_id"`);
    await queryRunner.query(`ALTER TABLE "trucks" DROP CONSTRAINT "FK_trucks_warehouse"`);
    await queryRunner.query(`ALTER TABLE "trucks" DROP COLUMN "warehouse_id"`);
    await queryRunner.query(`ALTER TABLE "trucks" DROP CONSTRAINT "UQ_trucks_odoo_truck_id"`);
    await queryRunner.query(`ALTER TABLE "trucks" DROP COLUMN "odoo_truck_id"`);
  }
}
