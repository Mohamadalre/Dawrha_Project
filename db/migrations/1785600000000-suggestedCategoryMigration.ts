import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A proposal may ask for a CATEGORY that does not exist yet.
 *
 * A new material very often belongs to a category nobody has set up. Until now
 * the proposer had two options, and both lost the information the proposal was
 * made to carry: file it under a category it does not belong to, or leave the
 * category empty and hope the reviewer guesses.
 *
 * The name is stored as plain text and NEVER auto-creates a category. That is
 * the important half of the decision: categories are the shape of the whole
 * catalogue, and one created from a free-typed string would be spelled
 * differently by the next proposer with nothing to merge the two. The reviewer
 * reads the request and decides.
 *
 * Kept separate from the existing `category_id` rather than overloading it,
 * because "no category was chosen" and "a category was ASKED FOR" call for
 * different responses from the reviewer, and one nullable column cannot say
 * both.
 */
export class SuggestedCategoryMigration1785600000000 implements MigrationInterface {
  name = 'SuggestedCategoryMigration1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_suggestions"
        ADD "suggested_category_name" character varying(150)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_suggestions" DROP COLUMN "suggested_category_name"
    `);
  }
}
