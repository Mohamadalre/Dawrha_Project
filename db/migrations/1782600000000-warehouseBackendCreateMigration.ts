import { MigrationInterface, QueryRunner } from "typeorm";

export class WarehouseBackendCreateMigration1782600000000 implements MigrationInterface {
    name = 'WarehouseBackendCreateMigration1782600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Warehouses are now authored in the backend and pushed to Odoo, so the
        // Odoo id is no longer known up front.
        await queryRunner.query(`ALTER TABLE "warehouses" ALTER COLUMN "odoo_warehouse_id" DROP NOT NULL`);
        await queryRunner.query(`CREATE TYPE "public"."warehouses_odoo_sync_status_enum" AS ENUM('PENDING', 'SYNCED', 'FAILED')`);
        await queryRunner.query(`ALTER TABLE "warehouses" ADD "odoo_sync_status" "public"."warehouses_odoo_sync_status_enum" NOT NULL DEFAULT 'PENDING'`);
        await queryRunner.query(`ALTER TABLE "warehouses" ADD "zones" jsonb`);
        // Existing rows were imported from Odoo → mark them as already synced.
        await queryRunner.query(`UPDATE "warehouses" SET "odoo_sync_status" = 'SYNCED' WHERE "odoo_warehouse_id" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN "zones"`);
        await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN "odoo_sync_status"`);
        await queryRunner.query(`DROP TYPE "public"."warehouses_odoo_sync_status_enum"`);
        await queryRunner.query(`ALTER TABLE "warehouses" ALTER COLUMN "odoo_warehouse_id" SET NOT NULL`);
    }

}
