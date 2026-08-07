import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records HOW an offer was expressed, so a later price edit knows what to keep.
 *
 * Every offer stores an `amount`, because everything downstream applies one.
 * But an administrator who said "25% off" and one who said "5 off" agreed to
 * different things, and until now the row could not tell them apart: both
 * produced an amount and nothing recorded which was the promise. Editing the
 * material's price then left the percentage offer quietly wrong — 25% off 80
 * is 20, and after the price rose to 100 that same 20 is a fifth off, not a
 * quarter.
 *
 * Two columns:
 *   `basis`            — AMOUNT (default) or PERCENTAGE.
 *   `basis_percentage` — the percentage that was typed, for PERCENTAGE only.
 *
 * NOT the same as `discount_percentage`, which already exists and is DERIVED:
 * that column is what the current amount comes to against the current price,
 * recomputed for every offer whatever its basis, and used to rank offers by
 * real money. This pair records intent; that column records effect. They agree
 * when an offer is written and are meant to diverge afterwards.
 *
 * Backfill is deliberately AMOUNT for every existing row. An offer created
 * before this column existed was agreed as a fixed reduction — nobody promised
 * a percentage that the system was not keeping — so treating them as
 * percentage-based would start recomputing amounts nobody asked to change.
 */
export class OfferBasisMigration1787000000000 implements MigrationInterface {
  name = 'OfferBasisMigration1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offers"
        ADD COLUMN IF NOT EXISTS "basis" varchar(16) NOT NULL DEFAULT 'AMOUNT'
    `);
    await queryRunner.query(`
      ALTER TABLE "offers"
        ADD COLUMN IF NOT EXISTS "basis_percentage" numeric(5,2) NULL
    `);

    // A percentage basis without its percentage is not a basis — it is a row
    // that cannot be recomputed and would silently fall back to whatever the
    // amount happened to be. The database refuses that pairing outright.
    await queryRunner.query(`
      ALTER TABLE "offers"
        DROP CONSTRAINT IF EXISTS "offers_basis_percentage_ck"
    `);
    await queryRunner.query(`
      ALTER TABLE "offers"
        ADD CONSTRAINT "offers_basis_percentage_ck" CHECK (
          ("basis" = 'AMOUNT'     AND "basis_percentage" IS NULL)
          OR
          ("basis" = 'PERCENTAGE' AND "basis_percentage" IS NOT NULL
                                  AND "basis_percentage" > 0)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "offers_basis_percentage_ck"
    `);
    await queryRunner.query(`
      ALTER TABLE "offers" DROP COLUMN IF EXISTS "basis_percentage"
    `);
    await queryRunner.query(`ALTER TABLE "offers" DROP COLUMN IF EXISTS "basis"`);
  }
}
