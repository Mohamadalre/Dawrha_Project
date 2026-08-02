import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A buyer's shortlist of materials.
 *
 * One table for all four buyer roles — citizen, institution, factory, free
 * facility — because it is the same act for every one of them. Four tables
 * would be four schemas, four services, and four copies of the same bug.
 *
 * Keyed on the ACCOUNT rather than the profile: the profile is the paperwork of
 * one role and a citizen barely has one, while the account is what every buyer
 * has and what the token carries. So the ownership check is a comparison
 * against the signed-in id, never a join.
 *
 * (account, product) is UNIQUE. Favouriting is idempotent by nature — tapping
 * a heart twice on a slow connection must leave one row, and the count on the
 * screen must not depend on how many times a button was pressed while it
 * looked unresponsive.
 *
 * Both foreign keys CASCADE. A deleted account has no shortlist, and a deleted
 * material cannot be a favourite of anything: leaving either would put a dead
 * entry on somebody's list that they can see and cannot remove.
 *
 * Column names are snake_case: this project maps entity properties through
 * SnakeNamingStrategy.
 */
export class FavouritesMigration1786700000000 implements MigrationInterface {
  name = 'FavouritesMigration1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "favourites" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "note"       character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_favourites" PRIMARY KEY ("id"),
        CONSTRAINT "FK_favourites_account" FOREIGN KEY ("account_id")
          REFERENCES "accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_favourites_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_favourite_account_product"
        ON "favourites" ("account_id", "product_id")
    `);

    // The listing is always "this buyer's favourites, newest first", so the
    // index carries the sort as well as the filter.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_favourites_account_created"
        ON "favourites" ("account_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "favourites"`);
  }
}
