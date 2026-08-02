import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ratings and complaints — both attached to a PART, never to the whole order.
 *
 * In a split order one warehouse may have been excellent and another poor. A
 * single rating averages them into a number that blames nobody and teaches
 * nothing; a complaint against "the order" names no one who can answer it.
 * Per part, ratings aggregate into a real performance figure per warehouse, and
 * a complaint arrives at the desk that holds the evidence.
 */
export class OrderFeedbackMigration1785200000000 implements MigrationInterface {
  name = 'OrderFeedbackMigration1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "order_complaints_kind_enum" AS ENUM(
        'SHORTAGE','QUALITY','DELIVERY','BILLING','OTHER')
    `);
    await queryRunner.query(
      `CREATE TYPE "order_complaints_route_enum" AS ENUM('WAREHOUSE','ADMIN')`,
    );
    await queryRunner.query(`
      CREATE TYPE "order_complaints_status_enum" AS ENUM(
        'OPEN','IN_REVIEW','RESOLVED','REJECTED')
    `);

    await queryRunner.query(`
      CREATE TABLE "order_part_ratings" (
        "id"           uuid NOT NULL DEFAULT uuid_generate_v4(),
        "part_id"      uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "stars"        smallint NOT NULL,
        "note"         character varying(1000),
        "created_at"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_part_ratings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_rating_stars" CHECK ("stars" BETWEEN 1 AND 5)
      )
    `);
    // One rating per part: a buyer revises their verdict, they do not stack it.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ratings_part" ON "order_part_ratings" ("part_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ratings_warehouse" ON "order_part_ratings" ("warehouse_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_part_ratings" ADD CONSTRAINT "FK_ratings_part"
         FOREIGN KEY ("part_id") REFERENCES "order_parts"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_part_ratings" ADD CONSTRAINT "FK_ratings_warehouse"
         FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_complaints" (
        "id"                uuid NOT NULL DEFAULT uuid_generate_v4(),
        "part_id"           uuid NOT NULL,
        "order_id"          uuid NOT NULL,
        "warehouse_id"      uuid NOT NULL,
        "kind"              "order_complaints_kind_enum" NOT NULL,
        "route"             "order_complaints_route_enum" NOT NULL,
        "status"            "order_complaints_status_enum" NOT NULL DEFAULT 'OPEN',
        "description"       character varying(2000) NOT NULL,
        "claimed_shortfall" numeric(12,3),
        "odoo_complaint_id" integer,
        "resolution"        character varying(2000),
        "resolved_by"       uuid,
        "resolved_at"       TIMESTAMP WITH TIME ZONE,
        "created_at"        TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_complaints" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_part_status" ON "order_complaints" ("part_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_order" ON "order_complaints" ("order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_warehouse" ON "order_complaints" ("warehouse_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_status" ON "order_complaints" ("status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_complaints" ADD CONSTRAINT "FK_complaints_part"
         FOREIGN KEY ("part_id") REFERENCES "order_parts"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_complaints" ADD CONSTRAINT "FK_complaints_warehouse"
         FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_complaints"`);
    await queryRunner.query(`DROP TABLE "order_part_ratings"`);
    await queryRunner.query(`DROP TYPE "order_complaints_status_enum"`);
    await queryRunner.query(`DROP TYPE "order_complaints_route_enum"`);
    await queryRunner.query(`DROP TYPE "order_complaints_kind_enum"`);
  }
}
