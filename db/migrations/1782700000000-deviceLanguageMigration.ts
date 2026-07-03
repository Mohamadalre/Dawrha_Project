import { MigrationInterface, QueryRunner } from "typeorm";

export class DeviceLanguageMigration1782700000000 implements MigrationInterface {
    name = 'DeviceLanguageMigration1782700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."user_devices_language_enum" AS ENUM('en', 'ar')`);
        await queryRunner.query(`ALTER TABLE "user_devices" ADD "language" "public"."user_devices_language_enum" NOT NULL DEFAULT 'en'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_devices" DROP COLUMN "language"`);
        await queryRunner.query(`DROP TYPE "public"."user_devices_language_enum"`);
    }

}
