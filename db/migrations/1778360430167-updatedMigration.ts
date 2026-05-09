import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedMigration1778360430167 implements MigrationInterface {
    name = 'UpdatedMigration1778360430167'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."media_owner_type_enum" RENAME TO "media_owner_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."media_owner_type_enum" AS ENUM('COLLECTOR', 'INSTITUTIONS', 'FACTORY')`);
        await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "owner_type" TYPE "public"."media_owner_type_enum" USING "owner_type"::"text"::"public"."media_owner_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."media_owner_type_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."media_owner_type_enum_old" AS ENUM('COLLECTOR', 'INSITUTIONS', 'FACTORY')`);
        await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "owner_type" TYPE "public"."media_owner_type_enum_old" USING "owner_type"::"text"::"public"."media_owner_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."media_owner_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."media_owner_type_enum_old" RENAME TO "media_owner_type_enum"`);
    }

}
