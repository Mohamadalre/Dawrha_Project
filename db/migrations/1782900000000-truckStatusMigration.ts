import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Replaces the truck status enum (active/maintenance/inactive) with
 * active/disabled/busy_one_driver/fully_busy. Existing maintenance & inactive
 * trucks become disabled.
 */
export class TruckStatusMigration1782900000000 implements MigrationInterface {
    name = 'TruckStatusMigration1782900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trucks" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TYPE "public"."trucks_status_enum" RENAME TO "trucks_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."trucks_status_enum" AS ENUM('active', 'disabled', 'busy_one_driver', 'fully_busy')`);
        await queryRunner.query(`ALTER TABLE "trucks" ALTER COLUMN "status" TYPE "public"."trucks_status_enum" USING (CASE "status"::text WHEN 'maintenance' THEN 'disabled' WHEN 'inactive' THEN 'disabled' ELSE 'active' END)::"public"."trucks_status_enum"`);
        await queryRunner.query(`ALTER TABLE "trucks" ALTER COLUMN "status" SET DEFAULT 'active'`);
        await queryRunner.query(`DROP TYPE "public"."trucks_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trucks" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TYPE "public"."trucks_status_enum" RENAME TO "trucks_status_enum_new"`);
        await queryRunner.query(`CREATE TYPE "public"."trucks_status_enum" AS ENUM('active', 'maintenance', 'inactive')`);
        await queryRunner.query(`ALTER TABLE "trucks" ALTER COLUMN "status" TYPE "public"."trucks_status_enum" USING (CASE "status"::text WHEN 'disabled' THEN 'inactive' ELSE 'active' END)::"public"."trucks_status_enum"`);
        await queryRunner.query(`ALTER TABLE "trucks" ALTER COLUMN "status" SET DEFAULT 'active'`);
        await queryRunner.query(`DROP TYPE "public"."trucks_status_enum_new"`);
    }

}
