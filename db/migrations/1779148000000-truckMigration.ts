import { MigrationInterface, QueryRunner } from "typeorm";

export class TruckMigration1779148000000 implements MigrationInterface {
    name = 'TruckMigration1779148000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."trucks_status_enum" AS ENUM('active', 'maintenance', 'inactive')`);
        await queryRunner.query(`CREATE TYPE "public"."truck_assignments_shift_enum" AS ENUM('morning', 'evening')`);

        await queryRunner.query(`CREATE TABLE "trucks" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "model" character varying NOT NULL,
            "year" integer NOT NULL,
            "plate_number" character varying NOT NULL,
            "max_payload_kg" numeric(10,2),
            "length_m" numeric(5,2),
            "width_m" numeric(5,2),
            "driving_license_image_url" character varying,
            "mechanics_image_url" character varying,
            "truck_with_plate_image_url" character varying,
            "status" "public"."trucks_status_enum" NOT NULL DEFAULT 'active',
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "UQ_trucks_plate_number" UNIQUE ("plate_number"),
            CONSTRAINT "PK_trucks_id" PRIMARY KEY ("id")
        )`);

        await queryRunner.query(`CREATE TABLE "truck_assignments" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "shift" "public"."truck_assignments_shift_enum" NOT NULL,
            "assigned_at" date NOT NULL,
            "truck_id" uuid NOT NULL,
            "driver_id" uuid NOT NULL,
            CONSTRAINT "UQ_truck_assignments_driver_id" UNIQUE ("driver_id"),
            CONSTRAINT "UQ_TRUCK_SHIFT" UNIQUE ("truck_id", "shift"),
            CONSTRAINT "PK_truck_assignments_id" PRIMARY KEY ("id")
        )`);

        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_truck_assignments_truck_id" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_truck_assignments_driver_id" FOREIGN KEY ("driver_id") REFERENCES "collector_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_truck_assignments_driver_id"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_truck_assignments_truck_id"`);
        await queryRunner.query(`DROP TABLE "truck_assignments"`);
        await queryRunner.query(`DROP TABLE "trucks"`);
        await queryRunner.query(`DROP TYPE "public"."truck_assignments_shift_enum"`);
        await queryRunner.query(`DROP TYPE "public"."trucks_status_enum"`);
    }
}
