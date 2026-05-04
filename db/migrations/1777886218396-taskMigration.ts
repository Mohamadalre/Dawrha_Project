import { MigrationInterface, QueryRunner } from "typeorm";

export class TaskMigration1777886218396 implements MigrationInterface {
    name = 'TaskMigration1777886218396'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_types" DROP COLUMN "other_text"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD "other_institution_type" character varying`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD "type_id" uuid`);
        await queryRunner.query(`ALTER TYPE "public"."media_file_type_enum" RENAME TO "media_file_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."media_file_type_enum" AS ENUM('INDUSTRIAL_REG', 'LICENSE', 'ID_CARD_FRONT', 'ID_CARD_BACK')`);
        await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "file_type" TYPE "public"."media_file_type_enum" USING "file_type"::"text"::"public"."media_file_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."media_file_type_enum_old"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD CONSTRAINT "FK_8ce4481fa6626912936a852b8c1" FOREIGN KEY ("type_id") REFERENCES "institution_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP CONSTRAINT "FK_8ce4481fa6626912936a852b8c1"`);
        await queryRunner.query(`CREATE TYPE "public"."media_file_type_enum_old" AS ENUM('INDUSTRIAL_REG', 'LICENSE', 'ID_CARD')`);
        await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "file_type" TYPE "public"."media_file_type_enum_old" USING "file_type"::"text"::"public"."media_file_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."media_file_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."media_file_type_enum_old" RENAME TO "media_file_type_enum"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP COLUMN "type_id"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP COLUMN "other_institution_type"`);
        await queryRunner.query(`ALTER TABLE "institution_types" ADD "other_text" character varying`);
    }

}
