import { MigrationInterface, QueryRunner } from "typeorm";

export class Er2roMigration1777841768303 implements MigrationInterface {
    name = 'Er2roMigration1777841768303'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "collector_profiles" ALTER COLUMN "address" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ALTER COLUMN "address" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ALTER COLUMN "address" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "address" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "address" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ALTER COLUMN "address" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ALTER COLUMN "address" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ALTER COLUMN "address" SET NOT NULL`);
    }

}
