import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Link an offer to the GRADE it applies to, by id.
 *
 * The offer held only `condition_code`, and a code is not an identifier: it is
 * unique inside its own material, so the string "GOOD" says nothing about whose
 * GOOD it is. Two consequences, both silent:
 *
 *   an offer could be filed against a code belonging to ANOTHER material, where
 *   it would never match a basket line and simply never apply — while still
 *   appearing live on every screen;
 *
 *   deleting a grade was allowed even when a live offer named it. The delete
 *   guard checked stock and the price list, not offers, so the offer was left
 *   pointing at a code that no longer existed.
 *
 * The foreign key does what validation cannot: the database itself now refuses
 * to delete a grade an offer names. That guarantee holds for every code path,
 * including the ones nobody has written yet.
 *
 * `condition_code` is KEPT, and deliberately. It is the join key everywhere
 * else — `product_pricing`, `cart_items` and the Odoo mirror are all keyed by
 * code — and resolving the id on every read would add a join to the hottest
 * queries in the catalogue. It is safe to hold alongside because a grade's code
 * is IMMUTABLE: `UpdateConditionDto` has no `code` field, so there is no rename
 * that could leave it stale, and the application always writes it from the
 * resolved grade rather than from user input.
 *
 * Column names are snake_case: this project maps entity properties through
 * SnakeNamingStrategy.
 */
export class OfferConditionLinkMigration1786800000000 implements MigrationInterface {
  name = 'OfferConditionLinkMigration1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offers"
        ADD COLUMN IF NOT EXISTS "condition_id" uuid
    `);

    // Backfill from the pair that DID identify a grade: the material and the
    // code together. Anything that fails to match was already broken — an
    // offer naming a grade its material does not have — and is left null
    // rather than pointed at a guess.
    await queryRunner.query(`
      UPDATE "offers" o
         SET "condition_id" = mc."id"
        FROM "material_conditions" mc
       WHERE o."condition_code" IS NOT NULL
         AND o."condition_id" IS NULL
         AND mc."product_id" = o."product_id"
         AND mc."code" = o."condition_code"
    `);

    // RESTRICT, not CASCADE. Deleting a grade that is being offered is a
    // mistake to stop, not a cascade to perform: silently deleting the offer
    // with it would withdraw a live discount that buyers can currently see,
    // with nothing to show it ever existed.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_offers_condition'
        ) THEN
          ALTER TABLE "offers"
            ADD CONSTRAINT "FK_offers_condition"
            FOREIGN KEY ("condition_id")
            REFERENCES "material_conditions"("id")
            ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_offers_condition_id"
        ON "offers" ("condition_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_offers_condition_id"`);
    await queryRunner.query(
      `ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "FK_offers_condition"`,
    );
    await queryRunner.query(
      `ALTER TABLE "offers" DROP COLUMN IF EXISTS "condition_id"`,
    );
  }
}
