import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDescriptionToAccount1779145653021 implements MigrationInterface {
    name = 'AddDescriptionToAccount1779145653021'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "accounts" ADD "description" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN "description"`);
    }

}
