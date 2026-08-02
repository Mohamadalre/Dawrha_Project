import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give warehouses a creation timestamp, and a name that cannot be duplicated.
 *
 * TIMESTAMPS. The table had none, so "newest first" was not a question it could
 * answer — the listing fell back to whatever order the planner happened to
 * return, and the warehouse an admin had just created could appear anywhere.
 * Existing rows are stamped with `now()` by the NOT NULL default: their real
 * creation date is not recorded anywhere and cannot be recovered, so they all
 * sort together as "oldest known" once newer ones arrive. Inventing distinct
 * dates for them would be inventing history.
 *
 * NAME UNIQUENESS. The name is what every human uses — it is on the paperwork,
 * on the shipment screen, in the order the driver is handed. Two warehouses
 * sharing one is a load delivered to the wrong building by somebody who read
 * the right name. Odoo has enforced this since it was written; the backend
 * checked only the code, so the pair disagreed about what was allowed and a
 * name accepted here failed forever in the sync queue.
 *
 * The index is case- and padding-insensitive, matching both the service check
 * and Odoo's `=ilike` rule: to a person reading a name aloud, "Damascus Main"
 * and "damascus main " are one warehouse.
 *
 * Column names are snake_case: this project maps entity properties through
 * SnakeNamingStrategy, so `createdAt` is `created_at` on disk.
 */
export class WarehouseTimestampsMigration1786600000000
  implements MigrationInterface
{
  name = 'WarehouseTimestampsMigration1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "warehouses"
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    `);

    // Ordering the listing is the whole reason the column exists, so it gets an
    // index rather than a sequential scan per page.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_warehouses_created_at"
        ON "warehouses" ("created_at" DESC)
    `);

    // Existing duplicates would abort the index build. There should be none —
    // Odoo has refused them all along — but the migration says so out loud
    // rather than failing halfway with a constraint-violation stack trace.
    const clashes = await queryRunner.query(`
      SELECT upper(btrim("name")) AS n, count(*)::int AS c
        FROM "warehouses" GROUP BY 1 HAVING count(*) > 1
    `);
    if (clashes.length) {
      const names = clashes.map((r: any) => `"${r.n}" ×${r.c}`).join(', ');
      throw new Error(
        `Cannot make warehouse names unique — these already repeat: ${names}. ` +
          'Rename them in Odoo (which owns the operational record) and re-run.',
      );
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_warehouses_name_ci"
        ON "warehouses" (upper(btrim("name")))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_warehouses_name_ci"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_warehouses_created_at"`);
    await queryRunner.query(`
      ALTER TABLE "warehouses"
        DROP COLUMN IF EXISTS "updated_at",
        DROP COLUMN IF EXISTS "created_at"
    `);
  }
}
