import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The fleet splits in two, and the mirror has to be able to say which is which.
 *
 * A COLLECTION truck picks material up from citizens and is driven by a
 * collector who works a shift and whose account lives here. A DELIVERY truck
 * carries sold goods to a buyer and is driven by someone recruited inside Odoo,
 * with no account here at all.
 *
 * Everything already in the table is COLLECTION — that is what the whole fleet
 * was before the split — so the default backfills every existing row correctly
 * rather than leaving them in a third, meaningless state.
 */
export class TruckTypeMigration1785700000000 implements MigrationInterface {
  name = 'TruckTypeMigration1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "trucks_truck_type_enum" AS ENUM ('COLLECTION', 'DELIVERY')
    `);
    await queryRunner.query(`
      ALTER TABLE "trucks"
        ADD "truck_type" "trucks_truck_type_enum" NOT NULL DEFAULT 'COLLECTION'
    `);
    // Indexed because the fleet screens filter on it, and because "show me the
    // delivery trucks" is the first thing asked of a mixed list.
    await queryRunner.query(`
      CREATE INDEX "IDX_trucks_truck_type" ON "trucks" ("truck_type")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trucks_truck_type"`);
    await queryRunner.query(`ALTER TABLE "trucks" DROP COLUMN "truck_type"`);
    await queryRunner.query(`DROP TYPE "trucks_truck_type_enum"`);
  }
}
