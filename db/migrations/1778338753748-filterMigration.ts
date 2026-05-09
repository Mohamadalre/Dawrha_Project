import { MigrationInterface, QueryRunner } from "typeorm";

export class FilterMigration1778338753748 implements MigrationInterface {
    name = 'FilterMigration1778338753748'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."accounts_role_enum" RENAME TO "accounts_role_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."accounts_role_enum" AS ENUM('CITIZEN', 'INSTITUTIONS', 'COLLECTOR', 'FACTORY', 'EXTERNAL_PARTNER', 'ADMIN')`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "role" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "role" TYPE "public"."accounts_role_enum" USING "role"::"text"::"public"."accounts_role_enum"`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "role" SET DEFAULT 'CITIZEN'`);
        await queryRunner.query(`DROP TYPE "public"."accounts_role_enum_old"`);
        await queryRunner.query(`ALTER TYPE "public"."role_permissions_role_enum" RENAME TO "role_permissions_role_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."role_permissions_role_enum" AS ENUM('CITIZEN', 'INSTITUTIONS', 'COLLECTOR', 'FACTORY', 'EXTERNAL_PARTNER', 'ADMIN')`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ALTER COLUMN "role" TYPE "public"."role_permissions_role_enum" USING "role"::"text"::"public"."role_permissions_role_enum"`);
        await queryRunner.query(`DROP TYPE "public"."role_permissions_role_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."role_permissions_role_enum_old" AS ENUM('CITIZEN', 'INSITUTIONS', 'COLLECTOR', 'FACTORY', 'EXTERNAL_PARTNER', 'ADMIN')`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ALTER COLUMN "role" TYPE "public"."role_permissions_role_enum_old" USING "role"::"text"::"public"."role_permissions_role_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."role_permissions_role_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."role_permissions_role_enum_old" RENAME TO "role_permissions_role_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."accounts_role_enum_old" AS ENUM('CITIZEN', 'INSITUTIONS', 'COLLECTOR', 'FACTORY', 'EXTERNAL_PARTNER', 'ADMIN')`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "role" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "role" TYPE "public"."accounts_role_enum_old" USING "role"::"text"::"public"."accounts_role_enum_old"`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "role" SET DEFAULT 'CITIZEN'`);
        await queryRunner.query(`DROP TYPE "public"."accounts_role_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."accounts_role_enum_old" RENAME TO "accounts_role_enum"`);
    }

}
