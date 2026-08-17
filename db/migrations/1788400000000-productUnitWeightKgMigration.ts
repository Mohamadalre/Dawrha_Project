import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Weight of one unit of a material, in kilograms — admin-only, for delivery.
 *
 * Delivery truck capacity is measured in kilograms, so a material sold by any
 * non-kg unit needs a per-unit weight before it can be loaded onto a route.
 * Null for kg-measured materials, where one unit already IS one kilogram.
 */
export class ProductUnitWeightKgMigration1788400000000
  implements MigrationInterface
{
  name = 'ProductUnitWeightKgMigration1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "unit_weight_kg" numeric(12,3)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "unit_weight_kg"`,
    );
  }
}
