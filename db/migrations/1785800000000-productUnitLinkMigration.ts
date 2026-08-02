import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Link a material to its measurement unit by ID, the way it is linked to its
 * category.
 *
 * Until now a material stored only the unit's CODE — a loose string validated
 * on write and never joined to anything. That is enough to render a label and
 * not enough for anything else: a unit could be renamed and every material
 * still claiming the old code would keep claiming it, and no query could ask
 * "which materials use this unit" without matching text.
 *
 * The code column stays. Odoo, the cart lines and the suggestion flow all speak
 * in codes, and making each of those resolve a uuid would be paying for the
 * link twice. `unit_id` is the truth; `unitType` is the denormalised label
 * written from it.
 *
 * Backfilled by matching the existing code, case-insensitively — the column was
 * normalised to uppercase on write, but rows predating that rule exist.
 * Anything that fails to match is left NULL rather than pointed at a guess: a
 * material silently reassigned to the wrong unit would misprice every order for
 * it, while a NULL is visible and answerable.
 */
export class ProductUnitLinkMigration1785800000000 implements MigrationInterface {
  name = 'ProductUnitLinkMigration1785800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "unit_id" uuid
    `);

    // `unit_type`, not `unitType`: this project maps entity properties through
    // SnakeNamingStrategy, so the column on disk is snake_case whatever the
    // TypeScript property is called. Writing the property name here produces a
    // migration that only fails once it is run — which is exactly what happened.
    await queryRunner.query(`
      UPDATE "products" p
         SET "unit_id" = u."id"
        FROM "measurement_units" u
       WHERE p."unit_id" IS NULL
         AND upper(trim(p."unit_type")) = upper(trim(u."code"))
    `);

    // RESTRICT, not CASCADE: deleting a unit must never delete the materials
    // measured in it. The admin route already refuses to remove a unit in use;
    // this makes the database refuse it too, so a direct SQL delete cannot do
    // what the API forbids.
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "FK_products_unit"
        FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_unit_id" ON "products" ("unit_id")
    `);

    const [{ orphans }] = await queryRunner.query(`
      SELECT COUNT(*)::int AS orphans FROM "products" WHERE "unit_id" IS NULL
    `);
    if (orphans > 0) {
      // Logged rather than thrown: refusing the migration would block a deploy
      // over data that is readable and fixable from the admin screen.
      console.warn(
        `[ProductUnitLinkMigration] ${orphans} material(s) have a unit code ` +
          'matching no unit row and were left unlinked — set their unit from ' +
          'the admin catalogue.',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_unit_id"`);
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "FK_products_unit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "unit_id"`,
    );
  }
}
