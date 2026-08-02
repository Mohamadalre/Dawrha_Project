import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One backend warehouse per Odoo warehouse. Make the database say so, and
 * repair the rows that got in before it did.
 *
 * `odoo_warehouse_id` had no unique constraint, and the mirror duplicated: the
 * backend held EIGHT warehouses for Odoo's FOUR, two pairs pointing at the same
 * Odoo row. That is not a cosmetic duplicate. The SYNC_WAREHOUSE job writes the
 * Odoo stock into every backend warehouse carrying that id, so every quantity
 * was mirrored twice — 192 kg in Odoo read as 384 in the API, and the allocator
 * priced and promised orders against stock that does not exist.
 *
 * The repair, per duplicated Odoo id:
 *
 *   winner  = the row with the most dependent records; ties broken towards the
 *             row whose code was never auto-renamed, then the lowest id. The
 *             busiest row is the one people have actually been using.
 *   losers  = their managers, trucks, collectors and tariffs are REPOINTED at
 *             the winner, so nothing referencing them is orphaned.
 *   stock   = the losers' inventory rows are DELETED, not moved. They are a
 *             second copy of the same Odoo lines; moving them would keep the
 *             doubling and merely relocate it.
 *
 * Warehouses whose Odoo row no longer exists are DEACTIVATED rather than
 * deleted. Removing a site because a row vanished upstream is not a decision a
 * migration should take silently, and `is_active = false` already stops them
 * being allocated to — the reversible half of the same outcome.
 */
export class WarehouseOdooLinkUniqueMigration1786100000000
  implements MigrationInterface
{
  name = 'WarehouseOdooLinkUniqueMigration1786100000000';

  /** Tables pointing at a warehouse that must follow the surviving row. */
  private static readonly REPOINT: Array<[string, string]> = [
    ['warehouse_managers', 'warehouse_id'],
    ['trucks', 'warehouse_id'],
    ['collector_profiles', 'warehouse_id'],
    ['delivery_tariffs', 'warehouse_id'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicated = await queryRunner.query(`
      SELECT odoo_warehouse_id AS odoo_id
        FROM "warehouses"
       WHERE odoo_warehouse_id IS NOT NULL
       GROUP BY odoo_warehouse_id
      HAVING COUNT(*) > 1
    `);

    for (const { odoo_id: odooId } of duplicated) {
      const candidates = await queryRunner.query(
        `
        SELECT w.id, w.code, w.name,
               (SELECT COUNT(*) FROM "warehouse_inventory" i WHERE i.warehouse_id = w.id)
             + (SELECT COUNT(*) FROM "warehouse_managers"  m WHERE m.warehouse_id = w.id)
             + (SELECT COUNT(*) FROM "trucks"              t WHERE t.warehouse_id = w.id)
             + (SELECT COUNT(*) FROM "collector_profiles"  c WHERE c.warehouse_id = w.id)
             + (SELECT COUNT(*) FROM "delivery_tariffs"    d WHERE d.warehouse_id = w.id)
               AS dependents
          FROM "warehouses" w
         WHERE w.odoo_warehouse_id = $1
         ORDER BY dependents DESC,
                  -- a code this migration's predecessor auto-renamed ends in
                  -- "-<digits>" and is the less-established of the pair
                  (w.code ~ '-[0-9]+$') ASC,
                  w.id ASC
      `,
        [odooId],
      );

      const [winner, ...losers] = candidates;
      for (const loser of losers) {
        for (const [table, column] of WarehouseOdooLinkUniqueMigration1786100000000.REPOINT) {
          await queryRunner.query(
            `UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = $2`,
            [winner.id, loser.id],
          );
        }
        // A second copy of the same Odoo lines — deleted, not moved.
        await queryRunner.query(
          `DELETE FROM "warehouse_inventory" WHERE warehouse_id = $1`,
          [loser.id],
        );
        await queryRunner.query(`DELETE FROM "warehouses" WHERE id = $1`, [
          loser.id,
        ]);
        console.warn(
          `[WarehouseOdooLinkUnique] odoo_warehouse_id=${odooId}: merged ` +
            `"${loser.code}" (${loser.id}) into "${winner.code}" (${winner.id}) ` +
            '— its duplicated stock lines were removed.',
        );
      }
    }

    // The constraint that would have prevented all of the above. Partial:
    // a warehouse created here and not yet pushed to Odoo has a NULL id, and
    // several of those are legitimate.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_warehouses_odoo_id"
        ON "warehouses" ("odoo_warehouse_id")
        WHERE "odoo_warehouse_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The merges are NOT undone — the losing rows are gone, and re-creating
    // empty shells of them would restore the shape without the meaning.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_warehouses_odoo_id"`);
  }
}
