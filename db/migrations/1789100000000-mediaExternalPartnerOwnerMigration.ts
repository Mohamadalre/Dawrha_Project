import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a FREE FACILITY (external partner) own uploaded documents.
 *
 * Their document step is OPTIONAL — a facility can be submitted for review with
 * no documents at all — but when they do upload one, its media row needs an
 * owner type of its own. Adding the enum value is accepted inside a transaction
 * on Postgres 12+, which is what the stack runs.
 */
export class MediaExternalPartnerOwnerMigration1789100000000 implements MigrationInterface {
  name = 'MediaExternalPartnerOwnerMigration1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."media_owner_type_enum" ADD VALUE IF NOT EXISTS 'EXTERNAL_PARTNER'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; leaving it in place is harmless
    // once no media row references it, and recreating the type is not worth the
    // risk here.
  }
}
