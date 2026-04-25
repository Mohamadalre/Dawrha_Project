import { MigrationInterface, QueryRunner } from "typeorm";

export class PermissionMigration1777071613710 implements MigrationInterface {
    name = 'PermissionMigration1777071613710'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "permission" ("id" SERIAL NOT NULL, "key" character varying NOT NULL, CONSTRAINT "UQ_20ff45fefbd3a7c04d2572c3bbd" UNIQUE ("key"), CONSTRAINT "PK_3b8b97af9d9d8807e41e6f48362" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."role_permission_role_enum" AS ENUM('CITIZEN', 'INSITUTIONS', 'COLLECTOR', 'FACTORY', 'EXTERNAL_PARTNER', 'ADMIN')`);
        await queryRunner.query(`CREATE TABLE "role_permission" ("id" SERIAL NOT NULL, "role" "public"."role_permission_role_enum" NOT NULL, "permission_id" integer, CONSTRAINT "PK_96c8f1fd25538d3692024115b47" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "role_permission" ADD CONSTRAINT "FK_e3a3ba47b7ca00fd23be4ebd6cf" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "role_permission" DROP CONSTRAINT "FK_e3a3ba47b7ca00fd23be4ebd6cf"`);
        await queryRunner.query(`DROP TABLE "role_permission"`);
        await queryRunner.query(`DROP TYPE "public"."role_permission_role_enum"`);
        await queryRunner.query(`DROP TABLE "permission"`);
    }

}
