import { MigrationInterface, QueryRunner } from "typeorm";

export class Testmigration1777242747943 implements MigrationInterface {
    name = 'Testmigration1777242747943'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "message"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "body" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "data" json`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "is_read" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TYPE "public"."user_devices_device_type_enum" RENAME TO "user_devices_device_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."user_devices_device_type_enum" AS ENUM('IOS', 'ANDROID')`);
        await queryRunner.query(`ALTER TABLE "user_devices" ALTER COLUMN "device_type" TYPE "public"."user_devices_device_type_enum" USING "device_type"::"text"::"public"."user_devices_device_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."user_devices_device_type_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."user_devices_device_type_enum_old" AS ENUM('IOS', 'WEB')`);
        await queryRunner.query(`ALTER TABLE "user_devices" ALTER COLUMN "device_type" TYPE "public"."user_devices_device_type_enum_old" USING "device_type"::"text"::"public"."user_devices_device_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."user_devices_device_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."user_devices_device_type_enum_old" RENAME TO "user_devices_device_type_enum"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "is_read"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "data"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "body"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "message" character varying NOT NULL`);
    }

}
