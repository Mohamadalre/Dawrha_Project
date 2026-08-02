import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The per-kilometre delivery rate, authored by the BACKEND administrator.
 *
 * A separate table from `delivery_tariffs` on purpose. That one is a read-only
 * mirror of what Odoo's administrator authors, and the sync job REPLACES it
 * whole on every change — so a rate written into it here would disappear the
 * next time anyone edited a tariff in Odoo, silently and with nothing in the
 * logs to follow. Two authors need two tables; sharing one would mean whichever
 * system wrote last wins, which is not a rule anyone can reason about.
 *
 * Rows are never overwritten. Setting a new rate closes the current one
 * (`effective_until`) and opens another, because a delivery quoted last month
 * was quoted at last month's rate — rewriting the number in place would make
 * every past quote unexplainable to the buyer who paid it.
 */
export class DeliveryRateMigration1785700000000 implements MigrationInterface {
  name = 'DeliveryRateMigration1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "delivery_rates" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "rate_per_km"     numeric(12,3) NOT NULL,
        "base_fee"        numeric(12,3) NOT NULL DEFAULT 0,
        "min_charge"      numeric(12,3) NOT NULL DEFAULT 0,
        "currency"        character varying(8) NOT NULL DEFAULT 'JOD',
        "is_active"       boolean NOT NULL DEFAULT true,
        "effective_from"  TIMESTAMP WITH TIME ZONE NOT NULL,
        "effective_until" TIMESTAMP WITH TIME ZONE,
        "note"            text,
        "created_by"      uuid,
        "updated_by"      uuid,
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_delivery_rates" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_delivery_rates_active" ON "delivery_rates" ("is_active")
    `);
    // Only ONE rate may be in force. Enforced in the database as well as in the
    // service: two active rows would make every quote depend on which one a
    // query happened to return first, and that is not a bug anybody would spot
    // — the prices would simply be wrong some of the time.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_delivery_rates_single_active"
        ON "delivery_rates" ("is_active") WHERE "is_active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_delivery_rates_single_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_delivery_rates_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_rates"`);
  }
}
