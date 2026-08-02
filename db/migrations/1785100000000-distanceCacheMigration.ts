import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cached road distances between a buyer and a warehouse.
 *
 * Exists so that placing an order costs ZERO calls to the distance provider.
 * Google's Distance Matrix bills per origin×destination element, and both
 * endpoints are effectively static — a factory does not move, and neither does
 * a warehouse — so without this the same pair would be re-billed on every
 * order.
 *
 * The unique index is load-bearing: two concurrent orders from the same buyer
 * race to fill the same pair, and the insert relies on the conflict to become
 * an update rather than a duplicate row.
 */
export class DistanceCacheMigration1785100000000 implements MigrationInterface {
  name = 'DistanceCacheMigration1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "distance_cache_source_enum" AS ENUM('GOOGLE','HAVERSINE')`,
    );
    await queryRunner.query(`
      CREATE TABLE "distance_cache" (
        "id"               uuid NOT NULL DEFAULT uuid_generate_v4(),
        "buyer_profile_id" uuid NOT NULL,
        "warehouse_id"     uuid NOT NULL,
        "distance_km"      numeric(10,3) NOT NULL,
        "duration_seconds" integer,
        "source"           "distance_cache_source_enum" NOT NULL,
        "computed_at"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_distance_cache" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_distance_cache_pair"
         ON "distance_cache" ("buyer_profile_id", "warehouse_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_distance_cache_buyer" ON "distance_cache" ("buyer_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_distance_cache_warehouse" ON "distance_cache" ("warehouse_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "distance_cache" ADD CONSTRAINT "FK_distance_cache_warehouse"
         FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "distance_cache"`);
    await queryRunner.query(`DROP TYPE "distance_cache_source_enum"`);
  }
}
