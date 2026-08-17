import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reshapes the two buyer "materials" blocks to what each role actually fills in.
 *
 * FACTORY keeps: categories, a POSITIVE-NUMBER quantity, a delivery preference,
 * and detailed delivery windows (new jsonb) — replacing the old single
 * morning/afternoon/evening enum and the order-schedule enum.
 *
 * EXTERNAL_PARTNER (free facility) keeps ONLY: categories and a positive-number
 * quantity — the schedule, delivery preference and delivery-schedule enum are
 * removed; a free facility does not schedule or arrange delivery.
 *
 * The quantity moves from free-text varchar to decimal(14,3) so a zero, a
 * negative or a non-number can no longer be stored.
 */
export class OnboardingMaterialsReshapeMigration1789400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── factory_materials ────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "factory_materials"
        ALTER COLUMN "average_order_quantity"
          TYPE numeric(14,3)
          USING NULLIF("average_order_quantity", '')::numeric
    `);
    await queryRunner.query(
      `ALTER TABLE "factory_materials" DROP COLUMN IF EXISTS "estimation_order_schedule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "factory_materials" DROP COLUMN IF EXISTS "perferred_delivery_schedule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "factory_materials" ADD COLUMN IF NOT EXISTS "delivery_time_slots" jsonb`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "factory_materials_estimation_order_schedule_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "factory_materials_perferred_delivery_schedule_enum"`,
    );

    // ── external_partner_materials ───────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "external_partner_materials"
        ALTER COLUMN "average_order_quantity"
          TYPE numeric(14,3)
          USING NULLIF("average_order_quantity", '')::numeric
    `);
    await queryRunner.query(
      `ALTER TABLE "external_partner_materials" DROP COLUMN IF EXISTS "estimation_order_schedule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_partner_materials" DROP COLUMN IF EXISTS "delivery_preference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_partner_materials" DROP COLUMN IF EXISTS "perferred_delivery_schedule"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "external_partner_materials_estimation_order_schedule_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "external_partner_materials_perferred_delivery_schedule_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort restore: the dropped columns come back nullable (their data is
    // gone) and the quantity returns to varchar.
    await queryRunner.query(
      `ALTER TABLE "factory_materials" DROP COLUMN IF EXISTS "delivery_time_slots"`,
    );
    await queryRunner.query(`
      ALTER TABLE "factory_materials"
        ALTER COLUMN "average_order_quantity" TYPE character varying
          USING "average_order_quantity"::character varying
    `);
    await queryRunner.query(
      `ALTER TABLE "factory_materials" ADD COLUMN IF NOT EXISTS "perferred_delivery_schedule" character varying`,
    );

    await queryRunner.query(`
      ALTER TABLE "external_partner_materials"
        ALTER COLUMN "average_order_quantity" TYPE character varying
          USING "average_order_quantity"::character varying
    `);
    await queryRunner.query(
      `ALTER TABLE "external_partner_materials" ADD COLUMN IF NOT EXISTS "delivery_preference" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_partner_materials" ADD COLUMN IF NOT EXISTS "perferred_delivery_schedule" character varying`,
    );
  }
}
