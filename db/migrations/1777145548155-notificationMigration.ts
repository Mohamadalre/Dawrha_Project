import { MigrationInterface, QueryRunner } from "typeorm";

export class NotificationMigration1777145548155 implements MigrationInterface {
    name = 'NotificationMigration1777145548155'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "permissions" ("id" SERIAL NOT NULL, "key" character varying NOT NULL, CONSTRAINT "UQ_017943867ed5ceef9c03edd9745" UNIQUE ("key"), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."role_permissions_role_enum" AS ENUM('CITIZEN', 'INSITUTIONS', 'COLLECTOR', 'FACTORY', 'EXTERNAL_PARTNER', 'ADMIN')`);
        await queryRunner.query(`CREATE TABLE "role_permissions" ("id" SERIAL NOT NULL, "role" "public"."role_permissions_role_enum" NOT NULL, "permission_id" integer, CONSTRAINT "PK_84059017c90bfcb701b8fa42297" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "message" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "user_devices" DROP COLUMN "device_type"`);
        await queryRunner.query(`CREATE TYPE "public"."user_devices_device_type_enum" AS ENUM('IOS', 'WEB')`);
        await queryRunner.query(`ALTER TABLE "user_devices" ADD "device_type" "public"."user_devices_device_type_enum"`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"`);
        await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_17022daf3f885f7d35423e9971e"`);
        await queryRunner.query(`ALTER TABLE "user_devices" DROP COLUMN "device_type"`);
        await queryRunner.query(`DROP TYPE "public"."user_devices_device_type_enum"`);
        await queryRunner.query(`ALTER TABLE "user_devices" ADD "device_type" character varying`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP TABLE "role_permissions"`);
        await queryRunner.query(`DROP TYPE "public"."role_permissions_role_enum"`);
        await queryRunner.query(`DROP TABLE "permissions"`);
    }

}
