import { MigrationInterface, QueryRunner } from "typeorm";

export class DviceMigration1777257114935 implements MigrationInterface {
    name = 'DviceMigration1777257114935'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_devices" ADD "accountId" uuid`);
        await queryRunner.query(`ALTER TABLE "user_devices" DROP COLUMN "refresh_token"`);
        await queryRunner.query(`ALTER TABLE "user_devices" ADD "refresh_token" text`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_78dd580b2287d6045f59f09677" ON "user_devices" ("account_id", "device_id") `);
        await queryRunner.query(`ALTER TABLE "user_devices" ADD CONSTRAINT "FK_dba08723b9008c4a2225b436a5b" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_devices" DROP CONSTRAINT "FK_dba08723b9008c4a2225b436a5b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_78dd580b2287d6045f59f09677"`);
        await queryRunner.query(`ALTER TABLE "user_devices" DROP COLUMN "refresh_token"`);
        await queryRunner.query(`ALTER TABLE "user_devices" ADD "refresh_token" character varying`);
        await queryRunner.query(`ALTER TABLE "user_devices" DROP COLUMN "accountId"`);
    }

}
