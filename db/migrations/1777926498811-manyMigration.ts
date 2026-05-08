import { MigrationInterface, QueryRunner } from "typeorm";

export class ManyMigration1777926498811 implements MigrationInterface {
    name = 'ManyMigration1777926498811'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP CONSTRAINT "FK_8952a4248803f54fafc3d3a2285"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP CONSTRAINT "UQ_8952a4248803f54fafc3d3a2285"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP COLUMN "institutionType"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD "institutionType" uuid`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD CONSTRAINT "UQ_8952a4248803f54fafc3d3a2285" UNIQUE ("institutionType")`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD CONSTRAINT "FK_8952a4248803f54fafc3d3a2285" FOREIGN KEY ("institutionType") REFERENCES "institution_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
