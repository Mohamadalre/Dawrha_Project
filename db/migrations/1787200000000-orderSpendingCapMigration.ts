import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin-managed MAXIMUM order spending per buyer role — the ceiling opposite
 * the existing order_minimums floor. One row per role (role UNIQUE), measured
 * over a DAILY or MONTHLY window against the goods total.
 */
export class OrderSpendingCapMigration1787200000000
  implements MigrationInterface
{
  name = 'OrderSpendingCapMigration1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "order_spending_caps_role_enum" AS ENUM(
         'CITIZEN','INSTITUTIONS','COLLECTOR','FACTORY','EXTERNAL_PARTNER','ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "order_spending_caps_period_enum" AS ENUM('DAILY','MONTHLY')`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_spending_caps" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role"       "order_spending_caps_role_enum" NOT NULL,
        "max_amount" numeric(14,3) NOT NULL DEFAULT 0,
        "period"     "order_spending_caps_period_enum" NOT NULL DEFAULT 'MONTHLY',
        "currency"   character varying NOT NULL DEFAULT 'JOD',
        "is_active"  boolean NOT NULL DEFAULT true,
        "updated_by" uuid,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_spending_caps" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_order_spending_caps_role" ON "order_spending_caps" ("role")`,
    );

    // Seed the two roles that order today, INACTIVE and at zero: the admin sets
    // the real ceiling. Seeding them active with a guessed cap would silently
    // block checkouts nobody chose to block — the same stance as the minimums.
    await queryRunner.query(`
      INSERT INTO "order_spending_caps" ("role", "max_amount", "period", "is_active")
      VALUES ('FACTORY', 0, 'MONTHLY', false), ('EXTERNAL_PARTNER', 0, 'MONTHLY', false)
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_spending_caps"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "order_spending_caps_period_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "order_spending_caps_role_enum"`);
  }
}
