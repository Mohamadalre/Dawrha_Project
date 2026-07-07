import { MigrationInterface, QueryRunner } from "typeorm";

export class PricingHistoryMigration1782500000000 implements MigrationInterface {
    name = 'PricingHistoryMigration1782500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."product_pricing_history_tier_enum" AS ENUM('INDIVIDUAL', 'COMPANY', 'FACTORY', 'FREE_FACILITY')`);
        await queryRunner.query(`CREATE TYPE "public"."product_pricing_history_archived_reason_enum" AS ENUM('UPDATED', 'DELETED')`);
        await queryRunner.query(`CREATE TABLE "product_pricing_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "tier" "public"."product_pricing_history_tier_enum" NOT NULL, "price" numeric(12,3) NOT NULL, "currency" character varying NOT NULL DEFAULT 'JOD', "effective_from" TIMESTAMP WITH TIME ZONE NOT NULL, "archived_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "archived_reason" "public"."product_pricing_history_archived_reason_enum" NOT NULL, "archived_by" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4d2e3b7e2f6f0a3c2d1b9a8e7f6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pph_product_tier" ON "product_pricing_history" ("product_id", "tier") `);
        await queryRunner.query(`ALTER TABLE "product_pricing_history" ADD CONSTRAINT "FK_pph_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // Move already-closed price rows out of the live table so product_pricing
        // only holds the current price per tier going forward.
        await queryRunner.query(`
            INSERT INTO "product_pricing_history"
                ("product_id", "tier", "price", "currency", "effective_from", "archived_at", "archived_reason")
            SELECT
                "product_id",
                "tier"::text::"public"."product_pricing_history_tier_enum",
                "price",
                "currency",
                "effective_from",
                COALESCE("effective_until", now()),
                'UPDATED'::"public"."product_pricing_history_archived_reason_enum"
            FROM "product_pricing"
            WHERE "effective_until" IS NOT NULL AND "effective_until" <= now()
        `);
        await queryRunner.query(`DELETE FROM "product_pricing" WHERE "effective_until" IS NOT NULL AND "effective_until" <= now()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product_pricing_history" DROP CONSTRAINT "FK_pph_product"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pph_product_tier"`);
        await queryRunner.query(`DROP TABLE "product_pricing_history"`);
        await queryRunner.query(`DROP TYPE "public"."product_pricing_history_archived_reason_enum"`);
        await queryRunner.query(`DROP TYPE "public"."product_pricing_history_tier_enum"`);
    }

}
