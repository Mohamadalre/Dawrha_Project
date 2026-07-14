import { MigrationInterface, QueryRunner } from 'typeorm';

/** Offers can target one material condition (grade) for factory/free-facility buyers. */
export class OfferConditionMigration1783500000000 implements MigrationInterface {
  name = 'OfferConditionMigration1783500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offers" ADD "condition_code" character varying(30)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offers" DROP COLUMN "condition_code"`);
  }
}
