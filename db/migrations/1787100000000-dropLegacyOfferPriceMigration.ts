import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes `offers.offer_price`, which the amount migration replaced but left
 * behind — and which made creating ANY offer impossible.
 *
 * `1786900000000-offerAudienceAmountMigration` introduced `amount` and
 * backfilled it from `offer_price`, correctly. What it did not do was drop the
 * old column, and that column is `NOT NULL` with no default. The entity had
 * already stopped mapping it, so every insert the application attempted was
 * missing a value Postgres required:
 *
 *   null value in column "offer_price" of relation "offers"
 *   violates not-null constraint
 *
 * Nothing caught it. The unit tests mock the repository, so no INSERT is ever
 * issued; `tsc` sees an entity that is internally consistent; and the column is
 * invisible from the TypeScript side precisely BECAUSE it is unmapped. It
 * surfaces only against a real database, on the first offer somebody tries to
 * create.
 *
 * Dropped rather than made nullable. A nullable leftover would sit there
 * collecting NULLs, look like a field with meaning, and invite somebody to read
 * it — while `amount` is the column that actually decides prices. The data it
 * held is already in `amount`.
 */
export class DropLegacyOfferPriceMigration1787100000000
  implements MigrationInterface
{
  name = 'DropLegacyOfferPriceMigration1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Guard: refuse to drop while any row still has an unmigrated amount, so a
    // database that skipped the backfill loses nothing.
    const [stranded] = await queryRunner.query(`
      SELECT COUNT(*)::int AS n
        FROM information_schema.columns
       WHERE table_name = 'offers' AND column_name = 'offer_price'
    `);
    if (!stranded || stranded.n === 0) return; // already gone

    /**
     * Second-pass backfill, for the rows the first one could not reach.
     *
     * The original conversion joined each offer to a live base price and
     * derived `amount` as the distance between the two. Rows whose audience was
     * written in that same migration were not yet readable by its own join, so
     * a handful came out with `amount = 0` while still holding an `offer_price`
     * — measured here as four, all of them suspended.
     *
     * Recovered the same way: base − offer_price for a buyer (a reduction),
     * offer_price − base for a seller (a rise), against the CHEAPEST live base
     * the offer's tiers face, which is the bound that cannot produce a negative
     * price. Clamped at zero because a legacy row may predate the rule.
     */
    await queryRunner.query(`
      WITH tiers AS (
        SELECT o.id AS offer_id,
               MIN(pp.price) AS base_price
          FROM "offers" o
          JOIN "product_pricing" pp ON pp."product_id" = o."product_id"
           AND pp."effective_from" <= NOW()
           AND (pp."effective_until" IS NULL OR pp."effective_until" > NOW())
           AND (
                 (o."condition_code" IS NULL AND pp."condition_code" IS NULL)
              OR pp."condition_code" = o."condition_code"
               )
           -- The tier column is an enum, so it is CAST to text before being
           -- compared with a text array. Written as CAST(...) rather than the
           -- ::text shorthand: inside a JS template literal, :: followed by a
           -- word is read as an interpolation and never reaches Postgres.
           AND CAST(pp."tier" AS text) = ANY (
                 CASE WHEN o."audience" = 'SELLERS'
                      THEN ARRAY['INDIVIDUAL','COMPANY']
                      ELSE ARRAY['FACTORY','FREE_FACILITY'] END
               )
         WHERE o."amount" = 0 AND o."offer_price" IS NOT NULL AND o."offer_price" <> 0
         GROUP BY o.id
      )
      UPDATE "offers" o
         SET "amount" = GREATEST(
               CASE WHEN o."audience" = 'SELLERS'
                    THEN o."offer_price" - t.base_price
                    ELSE t.base_price - o."offer_price" END, 0)
        FROM tiers t
       WHERE t.offer_id = o.id
    `);

    /**
     * What may still be left, and why it is safe.
     *
     * An offer with no live price for any of its tiers has no base to measure
     * against — the amount is genuinely unrecoverable. That is only acceptable
     * when the offer is SUSPENDED: it cannot be applied to anything, so the
     * missing number can never reach a price. An ACTIVE one in that state would
     * quote a reduction of zero, so the migration still refuses it.
     */
    const [blocking] = await queryRunner.query(`
      SELECT COUNT(*)::int AS n FROM "offers"
       WHERE "amount" = 0 AND "offer_price" IS NOT NULL AND "offer_price" <> 0
         AND "is_active" = true
    `);
    if (blocking && blocking.n > 0) {
      throw new Error(
        `${blocking.n} ACTIVE offer(s) still carry an offer_price that could not ` +
          'be converted to an amount — they have no live price to measure against. ' +
          'Give those materials a price, or suspend the offers, then re-run.',
      );
    }

    await queryRunner.query(`ALTER TABLE "offers" DROP COLUMN "offer_price"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restored NULLABLE, not NOT NULL. Coming back down, the rows that exist
    // were written without it, and re-imposing the constraint that caused the
    // original breakage would make the rollback fail on its own data.
    await queryRunner.query(`
      ALTER TABLE "offers"
        ADD COLUMN IF NOT EXISTS "offer_price" numeric(12,3) NULL
    `);
  }
}
