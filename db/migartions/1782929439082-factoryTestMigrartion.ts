import { MigrationInterface, QueryRunner } from "typeorm";

export class FactoryTestMigrartion1782929439082 implements MigrationInterface {
    name = 'FactoryTestMigrartion1782929439082'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_truck_assignments_shift"`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" DROP CONSTRAINT "FK_collector_profiles_shift"`);
        await queryRunner.query(`ALTER TABLE "product_pricing_history" DROP CONSTRAINT "FK_pph_product"`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_scr_driver"`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_scr_truck"`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_scr_shift"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pph_product_tier"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_scr_driver_status"`);
        await queryRunner.query(`CREATE INDEX "IDX_89f11118aa79545a4526febb40" ON "product_pricing_history" ("product_id", "tier") `);
        await queryRunner.query(`CREATE INDEX "IDX_9d4c809948f2b7c4212e3db216" ON "shift_change_requests" ("driver_id", "status") `);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_d94284bc4d3ec960f0a3b7d58ab" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ADD CONSTRAINT "FK_0f53c221e61900c1071cd0c4dd9" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_pricing_history" ADD CONSTRAINT "FK_09041dbe015c98e036a67fd187d" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_4674be86f4e1eda8787a37c0219" FOREIGN KEY ("driver_id") REFERENCES "collector_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_e569b15b68a9b96a9a86fca9a4f" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_8b5387fe3f2ddcdc7b1033915d7" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_8b5387fe3f2ddcdc7b1033915d7"`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_e569b15b68a9b96a9a86fca9a4f"`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" DROP CONSTRAINT "FK_4674be86f4e1eda8787a37c0219"`);
        await queryRunner.query(`ALTER TABLE "product_pricing_history" DROP CONSTRAINT "FK_09041dbe015c98e036a67fd187d"`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" DROP CONSTRAINT "FK_0f53c221e61900c1071cd0c4dd9"`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" DROP CONSTRAINT "FK_d94284bc4d3ec960f0a3b7d58ab"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9d4c809948f2b7c4212e3db216"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_89f11118aa79545a4526febb40"`);
        await queryRunner.query(`CREATE INDEX "IDX_scr_driver_status" ON "shift_change_requests" ("driver_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_pph_product_tier" ON "product_pricing_history" ("product_id", "tier") `);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_scr_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_scr_truck" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shift_change_requests" ADD CONSTRAINT "FK_scr_driver" FOREIGN KEY ("driver_id") REFERENCES "collector_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_pricing_history" ADD CONSTRAINT "FK_pph_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ADD CONSTRAINT "FK_collector_profiles_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "truck_assignments" ADD CONSTRAINT "FK_truck_assignments_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
