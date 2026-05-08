import { MigrationInterface, QueryRunner } from "typeorm";

export class OnboardingMigration1777924088026 implements MigrationInterface {
    name = 'OnboardingMigration1777924088026'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "factory_profiles" ALTER COLUMN "average_order_quantity" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ALTER COLUMN "estimation_order_schedule" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ALTER COLUMN "average_order_quantity" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ALTER COLUMN "estimation_order_schedule" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "estimated_waste_quantity" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "collection_frequney" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "status" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "status" DROP DEFAULT`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "status" SET DEFAULT 'PENDING'`);
        await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "status" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "collection_frequney" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "estimated_waste_quantity" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ALTER COLUMN "estimation_order_schedule" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ALTER COLUMN "average_order_quantity" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ALTER COLUMN "estimation_order_schedule" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ALTER COLUMN "average_order_quantity" SET NOT NULL`);
    }

}
