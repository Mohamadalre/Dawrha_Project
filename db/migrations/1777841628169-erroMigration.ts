import { MigrationInterface, QueryRunner } from "typeorm";

export class ErroMigration1777841628169 implements MigrationInterface {
    name = 'ErroMigration1777841628169'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "collector_profiles" ALTER COLUMN "coordinates" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ALTER COLUMN "coordinates" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "locations" ALTER COLUMN "address" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ALTER COLUMN "coordinates" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "coordinates" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "coordinates" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ALTER COLUMN "coordinates" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "locations" ALTER COLUMN "address" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ALTER COLUMN "coordinates" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ALTER COLUMN "coordinates" SET NOT NULL`);
    }

}
