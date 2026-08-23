import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `RECEIVED` to the collection-shipment status enum.
 *
 * A shipment (a truck's collected load) becomes DELIVERED when the driver drops
 * it at the warehouse, and RECEIVED when the RECEPTION employee scans its QR in
 * Odoo and confirms receipt — the moment the load is mirrored into Odoo as one
 * `recycle.shipment` and enters the reception/sorting flow. Only reception moves
 * a shipment to RECEIVED, and the driver sees the change.
 *
 * `ADD VALUE IF NOT EXISTS` is idempotent, so this is safe on a database that
 * already has the label. Postgres cannot remove an enum value, so `down`
 * intentionally does nothing — an unused label is harmless.
 */
export class ShipmentReceivedStatusMigration1790200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."shipment_status" ADD VALUE IF NOT EXISTS 'RECEIVED'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for an enum; the label stays. Harmless.
  }
}
