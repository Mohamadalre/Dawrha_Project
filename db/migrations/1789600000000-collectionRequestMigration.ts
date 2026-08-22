import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The collection-request domain: citizen/institution recycling pickups, the
 * dispatch elections that assign them to drivers, the routes drivers run, the
 * recurrence plans institutions hand to the generator cron, coverage points
 * for idle drivers and the single-row dispatch engine configuration.
 *
 * Nine tables, all hand-written with the same conventions as the rest of the
 * codebase: `uuid_generate_v4()` ids, `now()` timestamps, named constraints
 * and IF NOT EXISTS guards so the migration can be re-applied harmlessly.
 */
export class CollectionRequestMigration1789600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createEnums(queryRunner);
    await this.createPlansTables(queryRunner);
    await this.createCollectionsTables(queryRunner);
    await this.createCoverageTables(queryRunner);
    await this.createDispatchConfigTable(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "dispatch_config"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "driver_coverage_assignments"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "coverage_points"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "collection_plan_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "collection_plans"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "collection_routes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "collection_request_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "collection_request_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "collection_requests"`);

    await this.dropEnums(queryRunner);
  }

  private async createEnums(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "collection_request_type" AS ENUM
        ('IMMEDIATE', 'SCHEDULED', 'ORG_PLAN')
    `);
    await queryRunner.query(`
      CREATE TYPE "collection_request_status" AS ENUM
        ('CREATED', 'QUEUED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'PICKING',
         'DELIVERED', 'COMPLETED', 'NEEDS_ADMIN', 'CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE "collection_request_assignment_status" AS ENUM
        ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN')
    `);
    await queryRunner.query(`
      CREATE TYPE "collection_route_status" AS ENUM
        ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE "collection_plan_frequency" AS ENUM
        ('DAILY', 'WEEKLY', 'MONTHLY')
    `);
  }

  private async dropEnums(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TYPE IF EXISTS "collection_plan_frequency"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "collection_route_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "collection_request_assignment_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "collection_request_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "collection_request_type"`);
  }

  private async createCollectionsTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collection_routes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "route_number" character varying(32) NOT NULL,
        "driver_id" uuid NOT NULL,
        "status" "collection_route_status" NOT NULL DEFAULT 'PLANNED',
        "started_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "cancelled_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_routes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_collection_routes_number" UNIQUE ("route_number"),
        CONSTRAINT "FK_collection_routes_driver" FOREIGN KEY ("driver_id")
          REFERENCES "collector_profiles" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_routes_driver" ON "collection_routes" ("driver_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_routes_status" ON "collection_routes" ("status")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collection_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "request_number" character varying(32) NOT NULL,
        "type" "collection_request_type" NOT NULL DEFAULT 'IMMEDIATE',
        "status" "collection_request_status" NOT NULL DEFAULT 'CREATED',
        "account_id" uuid NOT NULL,
        "contact_name" character varying(255),
        "contact_phone" character varying(64),
        "address_text" character varying(500),
        "lat" numeric(10,7),
        "lng" numeric(10,7),
        "scheduled_at" TIMESTAMPTZ,
        "estimated_weight_kg" numeric(12,3) NOT NULL DEFAULT 0,
        "estimated_grand_total" numeric(14,2) NOT NULL DEFAULT 0,
        "actual_weight_kg" numeric(12,3),
        "actual_grand_total" numeric(14,2),
        "route_id" uuid,
        "route_sequence" integer,
        "source_plan_id" uuid,
        "source_plan_date" date,
        "cancellation_reason" character varying(255),
        "assigned_at" TIMESTAMPTZ,
        "en_route_at" TIMESTAMPTZ,
        "arrived_at" TIMESTAMPTZ,
        "picked_at" TIMESTAMPTZ,
        "delivered_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "cancelled_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_requests" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_collection_requests_number" UNIQUE ("request_number"),
        CONSTRAINT "UQ_collection_requests_plan_source" UNIQUE ("source_plan_id", "source_plan_date"),
        CONSTRAINT "FK_collection_requests_account" FOREIGN KEY ("account_id")
          REFERENCES "accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_collection_requests_route" FOREIGN KEY ("route_id")
          REFERENCES "collection_routes" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_collection_requests_plan" FOREIGN KEY ("source_plan_id")
          REFERENCES "collection_plans" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_requests_status" ON "collection_requests" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_requests_account" ON "collection_requests" ("account_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_requests_route" ON "collection_requests" ("route_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_requests_scheduled" ON "collection_requests" ("scheduled_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collection_request_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "product_name" character varying(255) NOT NULL,
        "unit_type" character varying(50) NOT NULL DEFAULT 'PIECE',
        "quantity" numeric(12,3) NOT NULL DEFAULT 0,
        "unit_price" numeric(14,2) NOT NULL DEFAULT 0,
        "total" numeric(14,2) NOT NULL DEFAULT 0,
        "note" character varying(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_request_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_collection_request_lines_request" FOREIGN KEY ("request_id")
          REFERENCES "collection_requests" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_request_lines_request" ON "collection_request_lines" ("request_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collection_request_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "request_id" uuid NOT NULL,
        "driver_id" uuid NOT NULL,
        "status" "collection_request_assignment_status" NOT NULL DEFAULT 'OFFERED',
        "score" numeric(6,2),
        "offer_expires_at" TIMESTAMPTZ,
        "responded_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_request_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_collection_request_assignments_request_driver" UNIQUE ("request_id", "driver_id"),
        CONSTRAINT "FK_collection_request_assignments_request" FOREIGN KEY ("request_id")
          REFERENCES "collection_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_collection_request_assignments_driver" FOREIGN KEY ("driver_id")
          REFERENCES "collector_profiles" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_request_assignments_driver" ON "collection_request_assignments" ("driver_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_request_assignments_status" ON "collection_request_assignments" ("status")`,
    );
  }

  private async createPlansTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collection_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "frequency" "collection_plan_frequency" NOT NULL DEFAULT 'WEEKLY',
        "weekdays" integer[],
        "month_days" integer[],
        "collection_time" TIME NOT NULL DEFAULT '10:00:00',
        "start_date" date,
        "end_date" date,
        "is_active" boolean NOT NULL DEFAULT true,
        "item_note" character varying(500),
        "last_generated_date" date,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_plans" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_collection_plans_account" UNIQUE ("account_id"),
        CONSTRAINT "FK_collection_plans_account" FOREIGN KEY ("account_id")
          REFERENCES "accounts" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_plans_active" ON "collection_plans" ("is_active")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "collection_plan_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "plan_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "product_name" character varying(255) NOT NULL,
        "unit_type" character varying(50) NOT NULL DEFAULT 'PIECE',
        "quantity" numeric(12,3) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_plan_lines" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_collection_plan_lines_plan_product" UNIQUE ("plan_id", "product_id"),
        CONSTRAINT "FK_collection_plan_lines_plan" FOREIGN KEY ("plan_id")
          REFERENCES "collection_plans" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_collection_plan_lines_plan" ON "collection_plan_lines" ("plan_id")`,
    );
  }

  private async createCoverageTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coverage_points" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(255) NOT NULL,
        "point_type" character varying(50) NOT NULL DEFAULT 'GENERAL',
        "lat" numeric(10,7) NOT NULL,
        "lng" numeric(10,7) NOT NULL,
        "radius_m" integer NOT NULL DEFAULT 1000,
        "priority" smallint NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coverage_points" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "driver_coverage_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "driver_id" uuid NOT NULL,
        "coverage_point_id" uuid NOT NULL,
        "assigned_from" TIMESTAMPTZ,
        "assigned_until" TIMESTAMPTZ,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_driver_coverage_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_driver_coverage_assignments_driver" UNIQUE ("driver_id"),
        CONSTRAINT "FK_driver_coverage_assignments_point" FOREIGN KEY ("coverage_point_id")
          REFERENCES "coverage_points" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IX_driver_coverage_assignments_point" ON "driver_coverage_assignments" ("coverage_point_id")`,
    );
  }

  private async createDispatchConfigTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dispatch_config" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "singleton" boolean NOT NULL DEFAULT true,
        "weights" jsonb NOT NULL DEFAULT '{"proximity":30,"direction":25,"load":20,"vehicle":15,"deadline":7,"fairness":3}'::jsonb,
        "accept_window_sec" integer NOT NULL DEFAULT 300,
        "scheduled_lead_min" integer NOT NULL DEFAULT 60,
        "route_merge_max_min" integer NOT NULL DEFAULT 15,
        "route_merge_max_km" numeric(8,2) NOT NULL DEFAULT 2,
        "institution_tolerance_min" integer NOT NULL DEFAULT 20,
        "rebalance_min" integer NOT NULL DEFAULT 30,
        "is_enabled" boolean NOT NULL DEFAULT true,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dispatch_config" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_dispatch_config_singleton" UNIQUE ("singleton")
      )
    `);

    // Seed exactly one row (the single dispatch engine instance).
    await queryRunner.query(`
      INSERT INTO "dispatch_config" ("singleton")
      VALUES (true)
      ON CONFLICT ("singleton") DO NOTHING
    `);
  }
}