import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Link a price row to the GRADE it prices, by id.
 *
 * `product_pricing` carried only `condition_code`. A grade code is unique only
 * WITHIN its material — `'GOOD'` names a different grade for scrap paper than
 * for copper — so the string alone could not identify one, and a client
 * reading a price sheet had nothing to act on but text. Renaming or re-coding a
 * grade also left every price row pointing at a code that no longer existed,
 * silently and with nothing to follow.
 *
 * The code column stays. Odoo mirrors stock lines by code and the cart carries
 * one; making each of those resolve a uuid would pay for the link twice.
 * `condition_id` is the truth, `condition_code` the denormalised label.
 *
 * Backfilled by matching (product, code). A row whose code matches no grade of
 * its own material is left NULL rather than pointed at a guess — a price
 * silently attached to the wrong grade misprices every order for it, while a
 * NULL is visible and answerable.
 *
 * RESTRICT, not CASCADE: deleting a grade must never silently delete the price
 * of the material it graded. The admin route already refuses to remove a grade
 * that is in use; this makes the database refuse it too, so a direct SQL delete
 * cannot do what the API forbids.
 */
export class PricingConditionLinkMigration1786300000000
  implements MigrationInterface
{
  name = 'PricingConditionLinkMigration1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_pricing"
        ADD COLUMN IF NOT EXISTS "condition_id" uuid
    `);

    await queryRunner.query(`
      UPDATE "product_pricing" p
         SET "condition_id" = c."id"
        FROM "material_conditions" c
       WHERE p."condition_id" IS NULL
         AND p."condition_code" IS NOT NULL
         AND c."product_id" = p."product_id"
         AND upper(btrim(c."code")) = upper(btrim(p."condition_code"))
    `);

    await queryRunner.query(`
      ALTER TABLE "product_pricing"
        ADD CONSTRAINT "FK_product_pricing_condition"
        FOREIGN KEY ("condition_id") REFERENCES "material_conditions"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_pricing_condition"
        ON "product_pricing" ("condition_id")
    `);

    const [{ orphans }] = await queryRunner.query(`
      SELECT COUNT(*)::int AS orphans
        FROM "product_pricing"
       WHERE "condition_code" IS NOT NULL AND "condition_id" IS NULL
    `);
    if (orphans > 0) {
      // Logged, not thrown: refusing the migration would block a deploy over
      // data that is readable and fixable from the pricing screen.
      console.warn(
        `[PricingConditionLinkMigration] ${orphans} price row(s) name a grade ` +
          'code that matches no grade of their own material, and were left ' +
          'unlinked — re-price those materials from the admin screen.',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_product_pricing_condition"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_pricing" DROP CONSTRAINT IF EXISTS "FK_product_pricing_condition"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_pricing" DROP COLUMN IF EXISTS "condition_id"`,
    );
  }
}
