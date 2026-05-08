import { MigrationInterface, QueryRunner } from "typeorm";

export class UnqinedMigration1777925103811 implements MigrationInterface {
    name = 'UnqinedMigration1777925103811'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "factory_profiles" DROP CONSTRAINT "UQ_2b06fb3379c78a0c634315d5f79"`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" DROP CONSTRAINT "UQ_3be80d063c46023251f937ea007"`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" DROP CONSTRAINT "UQ_0b14824a2e8161e50dd7ce1e04d"`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" DROP CONSTRAINT "UQ_e5adef643f12d18aac9490ecb0b"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP CONSTRAINT "UQ_b93c6f4420b2f525530c448722d"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP CONSTRAINT "UQ_e5027f0059db653aa8eb50dfd45"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD CONSTRAINT "UQ_e5027f0059db653aa8eb50dfd45" UNIQUE ("license_number")`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD CONSTRAINT "UQ_b93c6f4420b2f525530c448722d" UNIQUE ("institution_phone")`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ADD CONSTRAINT "UQ_e5adef643f12d18aac9490ecb0b" UNIQUE ("external_partner_phone")`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ADD CONSTRAINT "UQ_0b14824a2e8161e50dd7ce1e04d" UNIQUE ("industrial_record")`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ADD CONSTRAINT "UQ_3be80d063c46023251f937ea007" UNIQUE ("commercial_record")`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ADD CONSTRAINT "UQ_2b06fb3379c78a0c634315d5f79" UNIQUE ("factory_phone")`);
    }

}
