import { MigrationInterface, QueryRunner } from "typeorm";

export class Inital1776729664973 implements MigrationInterface {
    name = 'Inital1776729664973'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "provinces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name_en" character varying NOT NULL, "name_ar" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_355ba0f5e505deb69ca5ec60a9a" UNIQUE ("name_en"), CONSTRAINT "UQ_cf50f3b70e229599356d901ee98" UNIQUE ("name_ar"), CONSTRAINT "PK_2e4260eedbcad036ec53222e0c7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "cities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name_en" character varying NOT NULL, "name_ar" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "province_id" uuid, CONSTRAINT "UQ_355cee4941a3d461e95fea2d45e" UNIQUE ("name_en"), CONSTRAINT "UQ_6c289e215c7d8c4ea3f274c9148" UNIQUE ("name_ar"), CONSTRAINT "PK_4762ffb6e5d198cfec5606bc11e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "collector_profiles" ("coordinates" geography(Point,4326), "address" character varying, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "driving_cretificate_photo" character varying NOT NULL, "birth_date" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "province_id" uuid, "city_id" uuid, "account_id" uuid, "profile_add_profile_data" boolean NOT NULL DEFAULT false, "profile_add_location" boolean NOT NULL DEFAULT false, CONSTRAINT "REL_1edec27c4c46075041504623bf" UNIQUE ("account_id"), CONSTRAINT "PK_2bed80ad9102aa02d37f8b731a9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e8604b1bbe14e551469670e3e5" ON "collector_profiles" USING GiST ("coordinates") `);
        await queryRunner.query(`CREATE TABLE "factory_profiles" ("coordinates" geography(Point,4326), "address" character varying, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "factory_manager" character varying NOT NULL, "commercial_register" character varying NOT NULL, "factory_register" character varying NOT NULL, "factory_phone" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "province_id" uuid, "city_id" uuid, "account_id" uuid, "profile_add_profile_data" boolean NOT NULL DEFAULT false, "profile_add_location" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_d12db2d224ebe031b4f64a02805" UNIQUE ("commercial_register"), CONSTRAINT "UQ_523c191dc31203c6cc3556cfa53" UNIQUE ("factory_register"), CONSTRAINT "UQ_2b06fb3379c78a0c634315d5f79" UNIQUE ("factory_phone"), CONSTRAINT "REL_cec10e5c01f622b61d53cdffc8" UNIQUE ("account_id"), CONSTRAINT "PK_6eb20360bdf0aa668cc1292dc50" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_98480b28ff3a2c27d19c776a72" ON "factory_profiles" USING GiST ("coordinates") `);
        await queryRunner.query(`CREATE TABLE "citizen_profiles" ("coordinates" geography(Point,4326), "address" character varying, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "province_id" uuid, "city_id" uuid, "account_id" uuid, "profile_add_profile_data" boolean NOT NULL DEFAULT false, "profile_add_location" boolean NOT NULL DEFAULT false, CONSTRAINT "REL_535ccfb0323ffa49fcc993ed90" UNIQUE ("account_id"), CONSTRAINT "PK_40611f4ad750c47bd2744694bbd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_956ef814aee254185e0ee0dfe2" ON "citizen_profiles" USING GiST ("coordinates") `);
        await queryRunner.query(`CREATE TABLE "institution_profiles" ("coordinates" geography(Point,4326), "address" character varying, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "institution_manager" character varying NOT NULL, "institution_phone" character varying NOT NULL, "commercial_registration_number" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "province_id" uuid, "city_id" uuid, "account_id" uuid, "profile_add_profile_data" boolean NOT NULL DEFAULT false, "profile_add_location" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_b93c6f4420b2f525530c448722d" UNIQUE ("institution_phone"), CONSTRAINT "UQ_216f5213567bf686020e6b9c49c" UNIQUE ("commercial_registration_number"), CONSTRAINT "REL_a2be440fc8c48a62feae53428c" UNIQUE ("account_id"), CONSTRAINT "PK_2819c602f181b1fc3c202855f13" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7954869e79dc5cfbc322d2742d" ON "institution_profiles" USING GiST ("coordinates") `);
        await queryRunner.query(`CREATE TABLE "external_partner_profiles" ("coordinates" geography(Point,4326), "address" character varying, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "external_partner_manager" character varying NOT NULL, "external_partner_phone" character varying NOT NULL, "commercial_register" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "province_id" uuid, "city_id" uuid, "account_id" uuid, "profile_add_profile_data" boolean NOT NULL DEFAULT false, "profile_add_location" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_e5adef643f12d18aac9490ecb0b" UNIQUE ("external_partner_phone"), CONSTRAINT "UQ_30236f84619307fdc1e2849b896" UNIQUE ("commercial_register"), CONSTRAINT "REL_75886e8c00388db187bf4d94a6" UNIQUE ("account_id"), CONSTRAINT "PK_3ddc89d0c1cc2329064e5a7d110" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c42789554ebc81569ca9f6efcb" ON "external_partner_profiles" USING GiST ("coordinates") `);
        await queryRunner.query(`CREATE TYPE "public"."accounts_role_enum" AS ENUM('CITIZEN', 'INSITUTIONS', 'COLLECTOR', 'FACTORY', 'EXTERNAL_PARTNER', 'ADMIN')`);
        await queryRunner.query(`CREATE TYPE "public"."accounts_account_status_enum" AS ENUM('INACTIVE', 'PENDING_PROFILE', 'PENDING_APPROVAL', 'NEED_CHANGES', 'ACTIVE', 'REJECTED', 'BLOCKED')`);
        await queryRunner.query(`CREATE TYPE "public"."accounts_provider_enum" AS ENUM('LOCAL', 'GOOGLE')`);
        await queryRunner.query(`CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "email" character varying NOT NULL, "phone" character varying, "password_hash" character varying, "profile_image" character varying, "role" "public"."accounts_role_enum" NOT NULL DEFAULT 'CITIZEN', "account_status" "public"."accounts_account_status_enum" NOT NULL DEFAULT 'INACTIVE', "is_email_verified" boolean NOT NULL DEFAULT false, "google_id" character varying, "provider" "public"."accounts_provider_enum" NOT NULL DEFAULT 'LOCAL', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ee66de6cdc53993296d1ceb8aa0" UNIQUE ("email"), CONSTRAINT "UQ_41704a57004fc60242d7996bd85" UNIQUE ("phone"), CONSTRAINT "UQ_40cc98e2fa7c969876b1f270caa" UNIQUE ("google_id"), CONSTRAINT "PK_5a7a02c20412299d198e097a8fe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "user_devices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "account_id" character varying NOT NULL, "refresh_token" character varying, "fcm_token" character varying, "device_id" character varying, "device_type" character varying, "last_login" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_7c0755b2e06094d9dfb353a3772" UNIQUE ("device_id"), CONSTRAINT "PK_c9e7e648903a9e537347aba4371" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "cities" ADD CONSTRAINT "FK_52af18d505515614479e5c9f5e9" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ADD CONSTRAINT "FK_6103138c7bd32a1993130b8bba2" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ADD CONSTRAINT "FK_2c398e56c9ef0a30554887187eb" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" ADD CONSTRAINT "FK_1edec27c4c46075041504623bf0" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ADD CONSTRAINT "FK_56e70c1dabbb19f284877bffa7e" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ADD CONSTRAINT "FK_de1571d451cb38df5bcdc3923b8" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" ADD CONSTRAINT "FK_cec10e5c01f622b61d53cdffc82" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "citizen_profiles" ADD CONSTRAINT "FK_b9054dabcda324ab88fe5869da0" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "citizen_profiles" ADD CONSTRAINT "FK_943501abc7ca3f47bf6b5ba4b27" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "citizen_profiles" ADD CONSTRAINT "FK_535ccfb0323ffa49fcc993ed909" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD CONSTRAINT "FK_1db6b2e67edc9230e54541b8b4f" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD CONSTRAINT "FK_a7d260d23da33780abd8a4cbf3e" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" ADD CONSTRAINT "FK_a2be440fc8c48a62feae53428c5" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ADD CONSTRAINT "FK_5d8dd2c177e4c57a62cf1a0507f" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ADD CONSTRAINT "FK_c8fcfa57ed4363919e5db5e3d39" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" ADD CONSTRAINT "FK_75886e8c00388db187bf4d94a6c" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" DROP CONSTRAINT "FK_75886e8c00388db187bf4d94a6c"`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" DROP CONSTRAINT "FK_c8fcfa57ed4363919e5db5e3d39"`);
        await queryRunner.query(`ALTER TABLE "external_partner_profiles" DROP CONSTRAINT "FK_5d8dd2c177e4c57a62cf1a0507f"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP CONSTRAINT "FK_a2be440fc8c48a62feae53428c5"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP CONSTRAINT "FK_a7d260d23da33780abd8a4cbf3e"`);
        await queryRunner.query(`ALTER TABLE "institution_profiles" DROP CONSTRAINT "FK_1db6b2e67edc9230e54541b8b4f"`);
        await queryRunner.query(`ALTER TABLE "citizen_profiles" DROP CONSTRAINT "FK_535ccfb0323ffa49fcc993ed909"`);
        await queryRunner.query(`ALTER TABLE "citizen_profiles" DROP CONSTRAINT "FK_943501abc7ca3f47bf6b5ba4b27"`);
        await queryRunner.query(`ALTER TABLE "citizen_profiles" DROP CONSTRAINT "FK_b9054dabcda324ab88fe5869da0"`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" DROP CONSTRAINT "FK_cec10e5c01f622b61d53cdffc82"`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" DROP CONSTRAINT "FK_de1571d451cb38df5bcdc3923b8"`);
        await queryRunner.query(`ALTER TABLE "factory_profiles" DROP CONSTRAINT "FK_56e70c1dabbb19f284877bffa7e"`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" DROP CONSTRAINT "FK_1edec27c4c46075041504623bf0"`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" DROP CONSTRAINT "FK_2c398e56c9ef0a30554887187eb"`);
        await queryRunner.query(`ALTER TABLE "collector_profiles" DROP CONSTRAINT "FK_6103138c7bd32a1993130b8bba2"`);
        await queryRunner.query(`ALTER TABLE "cities" DROP CONSTRAINT "FK_52af18d505515614479e5c9f5e9"`);
        await queryRunner.query(`DROP TABLE "user_devices"`);
        await queryRunner.query(`DROP TABLE "accounts"`);
        await queryRunner.query(`DROP TYPE "public"."accounts_provider_enum"`);
        await queryRunner.query(`DROP TYPE "public"."accounts_account_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."accounts_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c42789554ebc81569ca9f6efcb"`);
        await queryRunner.query(`DROP TABLE "external_partner_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7954869e79dc5cfbc322d2742d"`);
        await queryRunner.query(`DROP TABLE "institution_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_956ef814aee254185e0ee0dfe2"`);
        await queryRunner.query(`DROP TABLE "citizen_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_98480b28ff3a2c27d19c776a72"`);
        await queryRunner.query(`DROP TABLE "factory_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e8604b1bbe14e551469670e3e5"`);
        await queryRunner.query(`DROP TABLE "collector_profiles"`);
        await queryRunner.query(`DROP TABLE "cities"`);
        await queryRunner.query(`DROP TABLE "provinces"`);
    }

}
