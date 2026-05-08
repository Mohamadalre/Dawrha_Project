import { MigrationInterface, QueryRunner } from "typeorm";

export class OnboardingUpdatedMigration1777924471735 implements MigrationInterface {
    name = 'OnboardingUpdatedMigration1777924471735'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "preferred_collection_time" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_profiles" ALTER COLUMN "preferred_collection_time" SET NOT NULL`);
    }

}
