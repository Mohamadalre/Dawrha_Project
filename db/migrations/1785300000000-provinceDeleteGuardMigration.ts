import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes the database refuse to orphan anything when a governorate is deleted.
 *
 * The rules were wrong in a way that failed SILENTLY, which is the worst kind:
 *
 *   warehouses.province_id      ON DELETE SET NULL → the warehouse survived with
 *                                no governorate, and a warehouse with no
 *                                governorate can never be matched to a buyer
 *                                again. Nothing errored; it just stopped being
 *                                a candidate for every future order.
 *   delivery_tariffs.province_id ON DELETE CASCADE → the governorate's delivery
 *                                pricing vanished with it, and quotes silently
 *                                fell back to the global tariff.
 *   orders.province_id           ON DELETE SET NULL → completed orders lost the
 *                                governorate they were placed in.
 *
 * All three become RESTRICT. The service already refuses with an itemised
 * message; this is the guarantee underneath it, and it also closes the race
 * where a warehouse is created between that check and the delete.
 */
export class ProvinceDeleteGuardMigration1785300000000
  implements MigrationInterface
{
  name = 'ProvinceDeleteGuardMigration1785300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "warehouses" DROP CONSTRAINT "FK_warehouses_province"`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD CONSTRAINT "FK_warehouses_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(
      `ALTER TABLE "delivery_tariffs" DROP CONSTRAINT "FK_delivery_tariffs_province"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_tariffs" ADD CONSTRAINT "FK_delivery_tariffs_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_orders_province"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_orders_province"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_tariffs" DROP CONSTRAINT "FK_delivery_tariffs_province"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_tariffs" ADD CONSTRAINT "FK_delivery_tariffs_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" DROP CONSTRAINT "FK_warehouses_province"`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD CONSTRAINT "FK_warehouses_province"
         FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE SET NULL`,
    );
  }
}
