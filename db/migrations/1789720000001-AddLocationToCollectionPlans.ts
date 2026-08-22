import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLocationToCollectionPlans1789720000001 implements MigrationInterface {
  name = 'AddLocationToCollectionPlans1789720000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "collection_plans" ADD COLUMN "lat" decimal(10,7)`);
    await queryRunner.query(`ALTER TABLE "collection_plans" ADD COLUMN "lng" decimal(10,7)`);
    await queryRunner.query(`ALTER TABLE "collection_plans" ADD COLUMN "address_text" varchar(500)`);
    await queryRunner.query(`ALTER TABLE "collection_plans" ADD COLUMN "contact_name" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "collection_plans" ADD COLUMN "contact_phone" varchar(64)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "collection_plans" DROP COLUMN "contact_phone"`);
    await queryRunner.query(`ALTER TABLE "collection_plans" DROP COLUMN "contact_name"`);
    await queryRunner.query(`ALTER TABLE "collection_plans" DROP COLUMN "address_text"`);
    await queryRunner.query(`ALTER TABLE "collection_plans" DROP COLUMN "lng"`);
    await queryRunner.query(`ALTER TABLE "collection_plans" DROP COLUMN "lat"`);
  }
}
