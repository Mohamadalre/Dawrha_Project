import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shift audience + lifecycle (Odoo is the shift master):
 * - shift_type: DRIVER shifts are offered to collectors; WAREHOUSE shifts
 *   belong to warehouse staff and never reach the driver app.
 *   Existing rows default to DRIVER (the backend's shifts were always
 *   driver-facing).
 * - is_active: turned off when the shift was deleted in Odoo but old rows
 *   (driver profiles / past requests) still reference it.
 */
export class ShiftTypeMigration1783700000000 implements MigrationInterface {
  name = 'ShiftTypeMigration1783700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."shifts_shift_type_enum" AS ENUM('DRIVER', 'WAREHOUSE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD "shift_type" "public"."shifts_shift_type_enum" NOT NULL DEFAULT 'DRIVER'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD "is_active" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "is_active"`);
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "shift_type"`);
    await queryRunner.query(`DROP TYPE "public"."shifts_shift_type_enum"`);
  }
}
