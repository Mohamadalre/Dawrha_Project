import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mirror the per-warehouse SHIPMENT count from Odoo.
 *
 * A warehouse detail has to answer "how much has come in here, and how much has
 * gone out". The going-out half was already answerable from this side — orders
 * are placed here, and `order_parts` names the warehouse for each share. The
 * coming-in half was not answerable at all: a shipment is a collector's
 * delivery being received, weighed and sorted, and every one of those steps
 * happens in Odoo. There is no shipments table here to count.
 *
 * So the number is mirrored rather than computed. The alternative — asking Odoo
 * over JSON-RPC on every read — would put a network round trip per warehouse
 * inside a listing that otherwise answers from a single query, and would make
 * the admin screen fail whenever Odoo was briefly unreachable.
 *
 * Defaults to 0 rather than NULL: "no shipments yet" and "never synced" both
 * read as zero to anybody looking at the screen, and a nullable counter invites
 * every consumer to write its own `?? 0`.
 *
 * Column names are snake_case: this project maps entity properties through
 * SnakeNamingStrategy, so `shipmentCount` is `shipment_count` on disk.
 */
export class WarehouseShipmentCountMigration1786700000000
  implements MigrationInterface
{
  name = 'WarehouseShipmentCountMigration1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "warehouses"
        ADD COLUMN IF NOT EXISTS "shipment_count" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "shipment_count"
    `);
  }
}
