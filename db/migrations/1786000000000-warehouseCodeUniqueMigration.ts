import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A warehouse code identifies ONE site. Make the database say so.
 *
 * `code` was a plain column on both sides, checked nowhere. Two warehouses
 * could carry the same code, and the damage is quiet and cumulative: the code
 * is what people write on paperwork, quote on the phone and search by, so a
 * duplicate means stock counted against the wrong site, an order routed to the
 * wrong building, and a reconciliation that never balances. It also breaks the
 * mirror — `import-from-odoo` matches on the Odoo id, but every human lookup in
 * between goes by code.
 *
 * Case-insensitive, on `upper(code)`. "W1" and "w1" are the same code to
 * everyone who uses one, and a constraint that disagrees with its users is a
 * constraint they will route around.
 *
 * Existing duplicates are RENAMED rather than merged: the second and later
 * holders get a `-2`, `-3` suffix, and the rename is logged. Merging two
 * warehouses means deciding which stock, staff and history to keep, and a
 * migration that decided that silently would be deciding it wrongly.
 */
export class WarehouseCodeUniqueMigration1786000000000
  implements MigrationInterface
{
  name = 'WarehouseCodeUniqueMigration1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Oldest holder keeps the code — it is the one most likely to be written
    // on paperwork already in circulation. Ranked by `id`, because the
    // warehouses table carries no timestamps: the uuids are v4 and therefore
    // not chronological, but "first row wins" is at least stable and
    // repeatable, which is what matters when the alternative is arbitrary.
    const duplicates = await queryRunner.query(`
      SELECT id, code, suffix FROM (
        SELECT id, code,
               ROW_NUMBER() OVER (
                 PARTITION BY upper(btrim(code)) ORDER BY id
               ) AS suffix
          FROM "warehouses"
         WHERE code IS NOT NULL AND btrim(code) <> ''
      ) ranked
       WHERE suffix > 1
    `);

    for (const row of duplicates) {
      const renamed = `${row.code}-${row.suffix}`;
      await queryRunner.query(
        `UPDATE "warehouses" SET "code" = $1 WHERE "id" = $2`,
        [renamed, row.id],
      );
      console.warn(
        `[WarehouseCodeUniqueMigration] warehouse ${row.id} had duplicate ` +
          `code "${row.code}" and was renamed to "${renamed}" — give it a real ` +
          'code from the admin screen.',
      );
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_warehouses_code"
        ON "warehouses" (upper(btrim("code")))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The renames are NOT undone: by now they may be the codes in use.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_warehouses_code"`);
  }
}
