import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The money-per-point conversion, per role.
 *
 * One rate per role (factory / free facility / institution / citizen). When a
 * buyer receives an order worth `amount_per_point × N`, the platform credits N
 * points to their wallet.
 */
export class PointsRateMigration1789300000000 implements MigrationInterface {
  name = 'PointsRateMigration1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."points_rates_role_enum" AS ENUM(
         'CITIZEN','INSTITUTIONS','COLLECTOR','FACTORY','EXTERNAL_PARTNER','ADMIN')`,
    );
    await queryRunner.query(`
      CREATE TABLE "points_rates" (
        "id"               uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role"             "public"."points_rates_role_enum" NOT NULL,
        "amount_per_point" numeric(14,3) NOT NULL,
        "currency"         character varying(8) NOT NULL DEFAULT 'SYP',
        "updated_by"       uuid,
        "created_at"       TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_points_rates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_points_rates_role" UNIQUE ("role")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "points_rates"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."points_rates_role_enum"`);
  }
}
