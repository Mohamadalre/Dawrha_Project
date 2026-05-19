import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDescriptionToAccount1779146183593 implements MigrationInterface {
    name = 'AddDescriptionToAccount1779146183593'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "description" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "description" SET DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "description" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "description" DROP NOT NULL`);
    }

}
