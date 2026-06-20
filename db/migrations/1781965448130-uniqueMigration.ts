import { MigrationInterface, QueryRunner } from "typeorm";

export class UniqueMigration1781965448130 implements MigrationInterface {
    name = 'UniqueMigration1781965448130'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_78dd580b2287d6045f59f09677"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "data"`);
        await queryRunner.query(`ALTER TABLE "waste_categories" ADD "image_category_url" character varying NOT NULL`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum" AS ENUM('GENERAL', 'ORDER', 'RECYCLING_REQUEST', 'WAREHOUSE', 'DRIVER', 'TRUCK', 'ODOO')`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "type" "public"."notifications_type_enum" NOT NULL DEFAULT 'GENERAL'`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_status_enum" AS ENUM('PENDING', 'SENT', 'FAILED')`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "status" "public"."notifications_status_enum" NOT NULL DEFAULT 'PENDING'`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "read_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "sent_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "failure_reason" text`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "metadata" jsonb`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "userId" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_devices" DROP CONSTRAINT "UQ_7c0755b2e06094d9dfb353a3772"`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "user_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "user_devices" ADD CONSTRAINT "UQ_78dd580b2287d6045f59f096773" UNIQUE ("account_id", "device_id")`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_692a909ee0fa9383e7859f9b406" FOREIGN KEY ("userId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_692a909ee0fa9383e7859f9b406"`);
        await queryRunner.query(`ALTER TABLE "user_devices" DROP CONSTRAINT "UQ_78dd580b2287d6045f59f096773"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "user_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_devices" ADD CONSTRAINT "UQ_7c0755b2e06094d9dfb353a3772" UNIQUE ("device_id")`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "userId"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "metadata"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "failure_reason"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "sent_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "read_at"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_status_enum"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "type"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`ALTER TABLE "waste_categories" DROP COLUMN "image_category_url"`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD "data" json`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_78dd580b2287d6045f59f09677" ON "user_devices" ("account_id", "device_id") `);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
