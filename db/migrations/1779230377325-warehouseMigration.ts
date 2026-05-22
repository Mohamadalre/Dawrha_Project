import { MigrationInterface, QueryRunner } from "typeorm";

export class WarehouseMigration1779230377325 implements MigrationInterface {
    name = 'WarehouseMigration1779230377325'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_truck_assignments_truck_id"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_truck_assignments_driver_id"`);
        await queryRunner.query(`CREATE TABLE "warehouse_managers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "full_name" character varying NOT NULL, "email" character varying NOT NULL, "phone" character varying NOT NULL, "odoo_user_id" integer NOT NULL, "warehouse_id" uuid, CONSTRAINT "UQ_0d6ccd7b687d21c446bd698bacc" UNIQUE ("email"), CONSTRAINT "REL_717e0b45ee1375721154e583de" UNIQUE ("warehouse_id"), CONSTRAINT "PK_2d89d37ff515b948bfe9de1c985" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "warehouses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "code" character varying NOT NULL, "odoo_warehouse_id" integer NOT NULL, CONSTRAINT "PK_56ae21ee2432b2270b48867e4be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_d2014334b9041ed43c502888cb8" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_2c881c70921b0ce716b05c55a44" FOREIGN KEY ("driver_id") REFERENCES "collector_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "warehouse_managers" ADD CONSTRAINT "FK_717e0b45ee1375721154e583dea" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "warehouse_managers" DROP CONSTRAINT "FK_717e0b45ee1375721154e583dea"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_2c881c70921b0ce716b05c55a44"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_d2014334b9041ed43c502888cb8"`);
        await queryRunner.query(`DROP TABLE "warehouses"`);
        await queryRunner.query(`DROP TABLE "warehouse_managers"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_truck_assignments_driver_id" FOREIGN KEY ("driver_id") REFERENCES "collector_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_truck_assignments_truck_id" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
