import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An offer is an AMOUNT aimed at a SIDE of the trade — not a final price.
 *
 * The platform stands between two sides of one deal: citizens and institutions
 * SELL material to it, factories and free facilities BUY sorted material from
 * it. "A better offer" therefore means opposite things to them — pay the seller
 * more, charge the buyer less — and an offer that did not record its side could
 * not say what it was offering.
 *
 * `offer_price` could only ever describe ONE tier, which is the deeper problem
 * it had. A single offer reaches two roles who are priced differently, so one
 * final price cannot be right for both: 7.50 is a discount off a factory's 10
 * and a rise on a free facility's 6. An AMOUNT applies to whatever each of them
 * already pays, so one row stays true for the whole audience.
 *
 * BACKFILL, and its limits. Existing rows carry a final price and a role list,
 * so the amount is recovered as the DIFFERENCE from the base price of the
 * cheapest tier the row targets — the interpretation under which the stored
 * price stays reachable for everyone it was aimed at. Rows whose base price
 * cannot be found are left at zero amount and deactivated rather than guessed
 * at: an offer nobody can price is an offer nobody should be quoted.
 *
 * Column names are snake_case (SnakeNamingStrategy).
 */
export class OfferAudienceAmountMigration1786900000000
  implements MigrationInterface
{
  name = 'OfferAudienceAmountMigration1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offers"
        ADD COLUMN IF NOT EXISTS "audience" character varying(16),
        ADD COLUMN IF NOT EXISTS "amount" numeric(12,3) NOT NULL DEFAULT 0
    `);

    // The side each existing row was aimed at. A row targeting nobody reached
    // everyone under the old rules; those cannot be split in two here, so they
    // are treated as BUYER offers — the only audience the old graded offers
    // could meaningfully have belonged to — and deactivated below if their
    // amount cannot be recovered.
    await queryRunner.query(`
      UPDATE "offers"
         SET "audience" = CASE
           WHEN "target_roles" IS NOT NULL
            AND ("target_roles" && ARRAY['CITIZEN','INSTITUTIONS']::text[])
            AND NOT ("target_roles" && ARRAY['FACTORY','EXTERNAL_PARTNER']::text[])
           THEN 'SELLERS' ELSE 'BUYERS' END
       WHERE "audience" IS NULL
    `);

    // Recover the amount as base − offer_price for buyers (a reduction), and
    // offer_price − base for sellers (a rise), against the CHEAPEST base the
    // row targeted so the stored price stays reachable for all of them.
    await queryRunner.query(`
      WITH base AS (
        SELECT o."id" AS offer_id,
               MIN(pp."price") AS base_price
          FROM "offers" o
          JOIN "product_pricing" pp
            ON pp."product_id" = o."product_id"
           AND pp."effective_from" <= NOW()
           AND (pp."effective_until" IS NULL OR pp."effective_until" > NOW())
           AND (o."condition_code" IS NULL
                OR pp."condition_code" = o."condition_code")
           -- The tier column is a Postgres ENUM, not text: comparing it to a
           -- text array fails outright rather than coercing, so it is cast to
           -- text on this side of the test.
           AND pp."tier"::text = ANY (
                 CASE WHEN o."audience" = 'SELLERS'
                      THEN ARRAY['INDIVIDUAL','COMPANY']::text[]
                      ELSE ARRAY['FACTORY','FREE_FACILITY']::text[] END)
         GROUP BY o."id"
      )
      UPDATE "offers" o
         SET "amount" = GREATEST(
               CASE WHEN o."audience" = 'SELLERS'
                    THEN o."offer_price" - base.base_price
                    ELSE base.base_price - o."offer_price" END, 0)
        FROM base
       WHERE base.offer_id = o."id"
    `);

    // An offer whose amount could not be recovered is switched off rather than
    // left quoting a number nobody can justify. It stays on file, so the admin
    // can see what happened and re-enter it.
    await queryRunner.query(`
      UPDATE "offers" SET "is_active" = false
       WHERE "amount" = 0 AND "offer_price" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "offers" ALTER COLUMN "audience" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_offers_audience"
        ON "offers" ("audience")
    `);

    // `offer_price` is KEPT for now, unused by the application. Dropping it in
    // the same step as the reinterpretation would destroy the only record of
    // what each offer used to say, and that record is what makes the backfill
    // above auditable at all.
    await queryRunner.query(`
      COMMENT ON COLUMN "offers"."offer_price" IS
        'SUPERSEDED by amount+audience. Kept for audit of the 1786900000000 backfill; safe to drop once verified.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_offers_audience"`);
    await queryRunner.query(`
      ALTER TABLE "offers"
        DROP COLUMN IF EXISTS "amount",
        DROP COLUMN IF EXISTS "audience"
    `);
  }
}
