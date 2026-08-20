import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the free-text `note` column from `delivery_rates`.
 *
 * The note was an optional "why the rate changed" field on the admin set/edit
 * form. It has been removed from the API: a delivery rate is a number and its
 * timeline (effective_from → effective_until), and a prose field on top of that
 * was neither quoted, searched, nor relied on anywhere. The column goes with it.
 *
 * The down migration re-adds it as a nullable text column, so a rollback returns
 * the schema exactly — though any previously stored notes are gone for good once
 * this runs, which is acceptable for a purely descriptive field.
 */
export class DeliveryRateDropNoteMigration1790000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_rates" DROP COLUMN IF EXISTS "note"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_rates" ADD COLUMN IF NOT EXISTS "note" text`,
    );
  }
}
