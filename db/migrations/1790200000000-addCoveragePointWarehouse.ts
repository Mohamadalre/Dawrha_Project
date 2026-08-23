import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `warehouse_id` column to `coverage_points`.
 *
 * The `CoveragePoint` entity already declares `warehouse_id` (and a `Warehouse`
 * relation) — used by the admin coverage-point CRUD (`coverage-points.service`)
 * to scope a point to a warehouse. The original `coverage_points` CREATE TABLE
 * migration omitted this column, so any query selecting coverage points fails
 * with "column CoveragePoint.warehouse_id does not exist".
 *
 * The column is nullable (a point may be warehouse-less) and references
 * `warehouses(id)` with ON DELETE SET NULL, mirroring the other warehouse FKs.
 */
export class AddCoveragePointWarehouse1790200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coverage_points" ADD "warehouse_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "coverage_points" ADD CONSTRAINT "FK_coverage_points_warehouse" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_coverage_points_warehouse" ON "coverage_points" ("warehouse_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IX_coverage_points_warehouse"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coverage_points" DROP CONSTRAINT IF EXISTS "FK_coverage_points_warehouse"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coverage_points" DROP COLUMN IF EXISTS "warehouse_id"`,
    );
  }
}
