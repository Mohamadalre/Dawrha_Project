import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the `category_requests` table.
 *
 * The category-request feature is gone: it existed only so an institution
 * confined to its picked categories could ASK for more and have an admin
 * approve them. Buyers are no longer restricted — everyone sees the whole active
 * catalogue — so a buyer now adds a category to their own list directly, and the
 * request table has nothing left to hold.
 */
export class DropCategoryRequestsMigration1787800000000 implements MigrationInterface {
  name = 'DropCategoryRequestsMigration1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "category_requests"`);
  }

  public async down(): Promise<void> {
    // One-way: the feature (its entity, service and routes) has been removed, so
    // there is nothing to recreate the table for. Restore from the feature's
    // own history if it is ever brought back.
  }
}
