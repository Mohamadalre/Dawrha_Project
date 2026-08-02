import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The ordering domain: one order as the buyer sees it, split into one part per
 * warehouse, plus the offer ledger that makes reallocation terminate.
 *
 * `order_parts` maps 1:1 onto `recycle.order` in Odoo — which is already bound
 * to a single warehouse — so a split order is simply several of them.
 *
 * `order_part_offers` rows are never deleted: the allocator subtracts every
 * warehouse that already refused (or went silent) from the next round's
 * candidates, which is what guarantees the search shrinks instead of looping.
 */
export class OrderDomainMigration1785000000000 implements MigrationInterface {
  name = 'OrderDomainMigration1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "orders_status_enum" AS ENUM(
        'PENDING_ALLOCATION','AWAITING_APPROVAL','NEEDS_CUSTOMER_DECISION',
        'NEEDS_ADMIN','PREPARING','IN_TRANSIT','READY_FOR_PICKUP',
        'DELIVERED','COMPLETED','CANCELLED')
    `);
    await queryRunner.query(
      `CREATE TYPE "orders_fulfilment_mode_enum" AS ENUM('DELIVERY','PICKUP')`,
    );
    // Dedicated role enums rather than reusing accounts_role_enum: TypeORM
    // derives the type name from <table>_<column>, so sharing one would make
    // the entity metadata and the database disagree on every future generate.
    await queryRunner.query(
      `CREATE TYPE "orders_buyer_role_enum" AS ENUM(
         'CITIZEN','INSTITUTIONS','COLLECTOR','FACTORY','EXTERNAL_PARTNER','ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "order_minimums_role_enum" AS ENUM(
         'CITIZEN','INSTITUTIONS','COLLECTOR','FACTORY','EXTERNAL_PARTNER','ADMIN')`,
    );
    await queryRunner.query(`
      CREATE TYPE "order_parts_status_enum" AS ENUM(
        'OFFERED','ACCEPTED','PROCESSING','STOCK_DEDUCTED','IN_OUTPUT_ZONE',
        'DISPATCHED','READY_FOR_PICKUP','DELIVERED','REJECTED','EXPIRED','CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE "order_part_offers_status_enum" AS ENUM(
        'OFFERED','ACCEPTED','REJECTED','EXPIRED','WITHDRAWN')
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id"                       uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_number"             character varying(32) NOT NULL,
        "buyer_account_id"         uuid NOT NULL,
        "buyer_role"               "orders_buyer_role_enum" NOT NULL,
        "buyer_profile_id"         uuid NOT NULL,
        "province_id"              uuid,
        "status"                   "orders_status_enum" NOT NULL DEFAULT 'PENDING_ALLOCATION',
        "fulfilment_mode"          "orders_fulfilment_mode_enum" NOT NULL,
        "accept_partial_fulfilment" boolean NOT NULL DEFAULT false,
        "allocation_round"         integer NOT NULL DEFAULT 0,
        "goods_total"              numeric(14,3) NOT NULL DEFAULT 0,
        "delivery_total"           numeric(14,3) NOT NULL DEFAULT 0,
        "grand_total"              numeric(14,3) NOT NULL DEFAULT 0,
        "currency"                 character varying NOT NULL DEFAULT 'JOD',
        "preparing_at"             TIMESTAMP WITH TIME ZONE,
        "delivered_at"             TIMESTAMP WITH TIME ZONE,
        "completed_at"             TIMESTAMP WITH TIME ZONE,
        "cancelled_at"             TIMESTAMP WITH TIME ZONE,
        "cancel_reason"            character varying(400),
        "created_at"               TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_orders_number" ON "orders" ("order_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_buyer_status" ON "orders" ("buyer_account_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_status" ON "orders" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_province" ON "orders" ("province_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_profile" ON "orders" ("buyer_profile_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_account"
         FOREIGN KEY ("buyer_account_id") REFERENCES "accounts"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_parts" (
        "id"                uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id"          uuid NOT NULL,
        "warehouse_id"      uuid NOT NULL,
        "sequence"          integer NOT NULL DEFAULT 1,
        "status"            "order_parts_status_enum" NOT NULL DEFAULT 'OFFERED',
        "odoo_order_id"     integer,
        "stock_reserved"    boolean NOT NULL DEFAULT false,
        "distance_km"       numeric(10,3) NOT NULL DEFAULT 0,
        "delivery_cost"     numeric(12,3) NOT NULL DEFAULT 0,
        "goods_total"       numeric(14,3) NOT NULL DEFAULT 0,
        "invoice_number"    character varying(64),
        "stock_deducted_at" TIMESTAMP WITH TIME ZONE,
        "output_zone_name"  character varying(128),
        "finished_at"       TIMESTAMP WITH TIME ZONE,
        "dispatched_at"     TIMESTAMP WITH TIME ZONE,
        "delivered_at"      TIMESTAMP WITH TIME ZONE,
        "reject_reason"     character varying(400),
        "created_at"        TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_parts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_parts_order_wh" ON "order_parts" ("order_id", "warehouse_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_parts_status" ON "order_parts" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_parts_odoo" ON "order_parts" ("odoo_order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_parts_warehouse" ON "order_parts" ("warehouse_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_parts" ADD CONSTRAINT "FK_order_parts_order"
         FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_parts" ADD CONSTRAINT "FK_order_parts_warehouse"
         FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_part_lines" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "part_id"        uuid NOT NULL,
        "product_id"     uuid NOT NULL,
        "odoo_product_id" integer,
        "product_name"   character varying(200) NOT NULL,
        "condition_code" character varying(30),
        "quantity"       numeric(12,3) NOT NULL,
        "unit_type"      character varying(20) NOT NULL,
        "unit_price"     numeric(12,3) NOT NULL,
        "subtotal"       numeric(14,3) NOT NULL,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_part_lines" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_part_lines_part" ON "order_part_lines" ("part_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_part_lines_product" ON "order_part_lines" ("product_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_part_lines" ADD CONSTRAINT "FK_order_part_lines_part"
         FOREIGN KEY ("part_id") REFERENCES "order_parts"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_part_lines" ADD CONSTRAINT "FK_order_part_lines_product"
         FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_part_offers" (
        "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
        "part_id"       uuid NOT NULL,
        "warehouse_id"  uuid NOT NULL,
        "order_id"      uuid NOT NULL,
        "round_number"  integer NOT NULL DEFAULT 1,
        "status"        "order_part_offers_status_enum" NOT NULL DEFAULT 'OFFERED',
        "offered_at"    TIMESTAMP WITH TIME ZONE NOT NULL,
        "expires_at"    TIMESTAMP WITH TIME ZONE NOT NULL,
        "responded_at"  TIMESTAMP WITH TIME ZONE,
        "reject_reason" character varying(400),
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_part_offers" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_offers_part_round" ON "order_part_offers" ("part_id", "round_number")`,
    );
    // The exclusion query the allocator runs every round.
    await queryRunner.query(
      `CREATE INDEX "IDX_offers_order_status" ON "order_part_offers" ("order_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_offers_warehouse" ON "order_part_offers" ("warehouse_id")`,
    );
    // The expiry sweep.
    await queryRunner.query(
      `CREATE INDEX "IDX_offers_expiry" ON "order_part_offers" ("status", "expires_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_part_offers" ADD CONSTRAINT "FK_offers_part"
         FOREIGN KEY ("part_id") REFERENCES "order_parts"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_part_offers" ADD CONSTRAINT "FK_offers_warehouse"
         FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_minimums" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role"            "order_minimums_role_enum" NOT NULL,
        "min_order_value" numeric(14,3) NOT NULL DEFAULT 0,
        "currency"        character varying NOT NULL DEFAULT 'JOD',
        "is_active"       boolean NOT NULL DEFAULT true,
        "updated_by"      uuid,
        "updated_at"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_minimums" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_order_minimums_role" ON "order_minimums" ("role")`,
    );

    // Seed the two roles that order today, inactive and at zero: the admin sets
    // the real numbers. Seeding them ACTIVE with a guessed floor would silently
    // block checkouts nobody chose to block.
    await queryRunner.query(`
      INSERT INTO "order_minimums" ("role", "min_order_value", "is_active")
      VALUES ('FACTORY', 0, false), ('EXTERNAL_PARTNER', 0, false)
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_minimums"`);
    await queryRunner.query(`DROP TABLE "order_part_offers"`);
    await queryRunner.query(`DROP TABLE "order_part_lines"`);
    await queryRunner.query(`DROP TABLE "order_parts"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TYPE "order_part_offers_status_enum"`);
    await queryRunner.query(`DROP TYPE "order_parts_status_enum"`);
    await queryRunner.query(`DROP TYPE "orders_fulfilment_mode_enum"`);
    await queryRunner.query(`DROP TYPE "order_minimums_role_enum"`);
    await queryRunner.query(`DROP TYPE "orders_buyer_role_enum"`);
    await queryRunner.query(`DROP TYPE "orders_status_enum"`);
  }
}
