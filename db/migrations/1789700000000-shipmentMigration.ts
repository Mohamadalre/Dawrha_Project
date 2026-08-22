import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shipments: groups multiple collected requests into one warehouse delivery.
 * A driver creates a shipment after collecting, then marks it delivered when
 * he physically drops the load at the warehouse.
 */
export class ShipmentMigration1789700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "shipment_status" AS ENUM
        ('CREATED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shipment_number" character varying(32) NOT NULL,
        "status" "shipment_status" NOT NULL DEFAULT 'CREATED',
        "driver_id" uuid NOT NULL,
        "truck_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "total_weight_kg" decimal(12,3) NOT NULL DEFAULT 0,
        "total_requests" integer NOT NULL DEFAULT 0,
        "notes" text,
        "collected_at" TIMESTAMPTZ,
        "departed_at" TIMESTAMPTZ,
        "delivered_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shipments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_shipments_number" UNIQUE ("shipment_number"),
        CONSTRAINT "FK_shipments_driver" FOREIGN KEY ("driver_id")
          REFERENCES "collector_profiles" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_shipments_truck" FOREIGN KEY ("truck_id")
          REFERENCES "trucks" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_shipments_warehouse" FOREIGN KEY ("warehouse_id")
          REFERENCES "warehouses" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_shipments_driver" ON "shipments" ("driver_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_shipments_truck" ON "shipments" ("truck_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_shipments_warehouse" ON "shipments" ("warehouse_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_shipments_status" ON "shipments" ("status")`,
    );

    // Add shipment FK to collection_requests
    await queryRunner.query(`
      ALTER TABLE "collection_requests"
      ADD COLUMN "shipment_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "collection_requests"
      ADD CONSTRAINT "FK_collection_requests_shipment"
      FOREIGN KEY ("shipment_id") REFERENCES "shipments" ("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_requests_shipment"
       ON "collection_requests" ("shipment_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "collection_requests" DROP CONSTRAINT IF EXISTS "FK_collection_requests_shipment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_requests" DROP COLUMN IF EXISTS "shipment_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "shipments"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "shipment_status"`);
  }
}
