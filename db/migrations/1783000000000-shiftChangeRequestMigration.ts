import { MigrationInterface, QueryRunner } from "typeorm";

export class ShiftChangeRequestMigration1783000000000 implements MigrationInterface {
    name = 'ShiftChangeRequestMigration1783000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."shift_change_requests_status_enum" AS ENUM('pending', 'processing', 'accepted', 'rejected')`);
        await queryRunner.query(`CREATE TABLE "shift_change_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "driver_id" uuid NOT NULL, "truck_id" uuid NOT NULL, "shift_id" uuid NOT NULL, "status" "public"."shift_change_requests_status_enum" NOT NULL DEFAULT 'pending', "rejection_reason" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_shift_change_requests_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_scr_driver_status" ON "shift_change_requests" ("driver_id", "status")`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_scr_driver" FOREIGN KEY ("driver_id") REFERENCES "collector_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_scr_truck" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_scr_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_scr_shift"`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_scr_truck"`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_scr_driver"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_scr_driver_status"`);
        await queryRunner.query(`DROP TABLE "shift_change_requests"`);
        await queryRunner.query(`DROP TYPE "public"."shift_change_requests_status_enum"`);
    }

}
