import { MigrationInterface, QueryRunner } from "typeorm";

export class ShiftMigration1782800000000 implements MigrationInterface {
    name = 'ShiftMigration1782800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1) Shifts table (structure only). The two shifts (Morning/Evening) are
        //    populated by the seeder (db/seeds/shift-seed.ts) — run `npm run seed`.
        await queryRunner.query(`CREATE TABLE "shifts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "start_time" TIME NOT NULL, "end_time" TIME NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_shifts_name" UNIQUE ("name"), CONSTRAINT "PK_shifts" PRIMARY KEY ("id"))`);

        // 2) collector_profiles.shift (enum) -> shift_id (FK).
        await queryRunner.query(`ALTER TABLE "collector_profiles" ADD "shift_id" uuid`);
        await queryRunner.query(`UPDATE "collector_profiles" SET "shift_id" = (SELECT "id" FROM "shifts" WHERE "name" = 'Morning') WHERE "shift" = 'MORNING'`);
        await queryRunner.query(`UPDATE "collector_profiles" SET "shift_id" = (SELECT "id" FROM "shifts" WHERE "name" = 'Evening') WHERE "shift" = 'EVENING'`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" DROP COLUMN "shift"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."collector_profiles_shift_enum"`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ALTER COLUMN "shift_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ADD CONSTRAINT "FK_collector_profiles_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        // 3) truck_assignments.shift (enum) -> shift_id (FK); assigned_at -> timestamptz.
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD "shift_id" uuid`);
        await queryRunner.query(`UPDATE "truck_assignments" SET "shift_id" = (SELECT "id" FROM "shifts" WHERE "name" = 'Morning') WHERE "shift" = 'morning'`);
        await queryRunner.query(`UPDATE "truck_assignments" SET "shift_id" = (SELECT "id" FROM "shifts" WHERE "name" = 'Evening') WHERE "shift" = 'evening'`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT IF EXISTS "UQ_TRUCK_SHIFT"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP COLUMN "shift"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."truck_assignments_shift_enum"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ALTER COLUMN "shift_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ALTER COLUMN "assigned_at" TYPE TIMESTAMP WITH TIME ZONE USING "assigned_at"::timestamptz`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "UQ_TRUCK_SHIFT" UNIQUE ("truck_id", "shift_id")`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_truck_assignments_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // truck_assignments: shift_id -> enum shift
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_truck_assignments_shift"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "UQ_TRUCK_SHIFT"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ALTER COLUMN "assigned_at" TYPE date USING "assigned_at"::date`);
        await queryRunner.query(`CREATE TYPE "public"."truck_assignments_shift_enum" AS ENUM('morning', 'evening')`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD "shift" "public"."truck_assignments_shift_enum"`);
        await queryRunner.query(`UPDATE "truck_assignments" SET "shift" = 'morning' WHERE "shift_id" = (SELECT "id" FROM "shifts" WHERE "name" = 'Morning')`);
        await queryRunner.query(`UPDATE "truck_assignments" SET "shift" = 'evening' WHERE "shift_id" = (SELECT "id" FROM "shifts" WHERE "name" = 'Evening')`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ALTER COLUMN "shift" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP COLUMN "shift_id"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "UQ_TRUCK_SHIFT" UNIQUE ("truck_id", "shift")`);

        // collector_profiles: shift_id -> enum shift
        await queryRunner.query(`ALTER TABLE "collector_profiles" DROP CONSTRAINT "FK_collector_profiles_shift"`);
        await queryRunner.query(`CREATE TYPE "public"."collector_profiles_shift_enum" AS ENUM('MORNING', 'EVENING')`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ADD "shift" "public"."collector_profiles_shift_enum"`);
        await queryRunner.query(`UPDATE "collector_profiles" SET "shift" = 'MORNING' WHERE "shift_id" = (SELECT "id" FROM "shifts" WHERE "name" = 'Morning')`);
        await queryRunner.query(`UPDATE "collector_profiles" SET "shift" = 'EVENING' WHERE "shift_id" = (SELECT "id" FROM "shifts" WHERE "name" = 'Evening')`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ALTER COLUMN "shift" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" DROP COLUMN "shift_id"`);

        await queryRunner.query(`DROP TABLE "shifts"`);
    }

}
