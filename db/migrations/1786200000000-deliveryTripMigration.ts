import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The milk run that carries a split order to its buyer.
 *
 * A buyer order no single warehouse could fill ends up in several of them, and
 * all of them have to reach the buyer. Sending a van from each bills three
 * journeys down largely the same road and occupies three drivers for one
 * delivery — so one truck starts at the FARTHEST warehouse, calls at the nearer
 * ones on the way in, and arrives loaded.
 *
 * Two tables because two different things are being recorded:
 *
 *   delivery_trips       one vehicle's run: the route, what it cost, who drove
 *   delivery_trip_stops  one warehouse call: which part, and WHEN THE DRIVER
 *                        TOOK IT — custody changes hands per stop, and a trip
 *                        in progress has some parts aboard and some not
 *
 * The cost columns are copies, not references. `rate_per_km` and `base_fee` are
 * frozen onto the trip at the moment of quoting: the admin can change the rate
 * tomorrow, and a buyer asking why they paid what they paid must get an answer
 * that does not change afterwards.
 */
export class DeliveryTripMigration1786200000000 implements MigrationInterface {
  name = 'DeliveryTripMigration1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "delivery_trips_status_enum" AS ENUM (
          'PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_trips" (
        "id"                  uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id"            uuid NOT NULL,
        "trip_number"         character varying(32) NOT NULL,
        "origin_warehouse_id" uuid NOT NULL,
        "odoo_truck_id"       integer,
        "odoo_driver_id"      integer,
        "driver_name"         character varying(160),
        "driver_phone"        character varying(32),
        "status"              "delivery_trips_status_enum" NOT NULL DEFAULT 'PLANNED',
        "route_distance_km"   numeric(10,3) NOT NULL DEFAULT 0,
        "delivery_cost"       numeric(12,3) NOT NULL DEFAULT 0,
        "rate_per_km"         numeric(12,3) NOT NULL DEFAULT 0,
        "base_fee"            numeric(12,3) NOT NULL DEFAULT 0,
        "currency"            character varying(8) NOT NULL DEFAULT 'SYP',
        "started_at"          TIMESTAMP WITH TIME ZONE,
        "completed_at"        TIMESTAMP WITH TIME ZONE,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_delivery_trips" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_delivery_trips_number" UNIQUE ("trip_number"),
        CONSTRAINT "FK_delivery_trips_order" FOREIGN KEY ("order_id")
          REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_delivery_trips_order"
        ON "delivery_trips" ("order_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_delivery_trips_origin"
        ON "delivery_trips" ("origin_warehouse_id")
    `);
    // The driver's own screen asks exactly this: my live trips.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_delivery_trips_driver_live"
        ON "delivery_trips" ("odoo_driver_id", "status")
        WHERE "odoo_driver_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delivery_trip_stops" (
        "id"                    uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trip_id"               uuid NOT NULL,
        "part_id"               uuid NOT NULL,
        "warehouse_id"          uuid NOT NULL,
        "sequence"              integer NOT NULL,
        "distance_to_buyer_km"  numeric(10,3) NOT NULL DEFAULT 0,
        "leg_distance_km"       numeric(10,3) NOT NULL DEFAULT 0,
        "leg_cost"              numeric(12,3) NOT NULL DEFAULT 0,
        "picked_up_at"          TIMESTAMP WITH TIME ZONE,
        "picked_up_note"        character varying(400),
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_delivery_trip_stops" PRIMARY KEY ("id"),
        -- One part is collected once, on one trip. Two rows would mean two
        -- trucks each believing they are carrying it.
        CONSTRAINT "UQ_delivery_trip_stops_part" UNIQUE ("trip_id", "part_id"),
        CONSTRAINT "FK_delivery_trip_stops_trip" FOREIGN KEY ("trip_id")
          REFERENCES "delivery_trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_delivery_trip_stops_part" FOREIGN KEY ("part_id")
          REFERENCES "order_parts"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_delivery_trip_stops_trip"
        ON "delivery_trip_stops" ("trip_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_delivery_trip_stops_warehouse"
        ON "delivery_trip_stops" ("warehouse_id")
    `);

    // NOT indexed: "one live trip per part".
    //
    // The obvious constraint — UNIQUE(part_id) WHERE picked_up_at IS NULL —
    // reads correctly and is a trap. A cancelled trip keeps its uncollected
    // stops, so the index would go on blocking that part for ever and the
    // order could never be re-planned. A partial index cannot look at the
    // trip's status to exclude it.
    //
    // The rule is enforced where it can see enough to be right: `planForOrder`
    // refuses while the order has a PLANNED, ASSIGNED or IN_PROGRESS trip.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_trip_stops"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_trips"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "delivery_trips_status_enum"`);
  }
}
