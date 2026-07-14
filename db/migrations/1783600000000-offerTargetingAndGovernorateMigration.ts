import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1) offers.target_roles: an offer may be limited to specific buyer roles
 *    (null = visible to everyone).
 * 2) warehouses.governorate: the governorate is captured on creation and
 *    pushed to Odoo (recycle.warehouse.governorate).
 */
export class OfferTargetingAndGovernorateMigration1783600000000 implements MigrationInterface {
  name = 'OfferTargetingAndGovernorateMigration1783600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offers" ADD "target_roles" text array`);
    await queryRunner.query(`ALTER TABLE "warehouses" ADD "governorate" character varying(100)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN "governorate"`);
    await queryRunner.query(`ALTER TABLE "offers" DROP COLUMN "target_roles"`);
  }
}
