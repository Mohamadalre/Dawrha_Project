import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the missing values to `product_pricing_history_archived_reason_enum`.
 *
 * The Postgres enum was created with only `UPDATED` and `DELETED`, but the code
 * archives price rows with two more reasons:
 *
 *   • `EXPIRED` — swept out by the admin-set expiry job (latent: this reason was
 *     added in code without a migration, so the expiry sweep would fail the
 *     first time it tried to archive a row here); and
 *   • `GRADED`  — a material gained its first grade, so the factory / free-
 *     facility CONDITIONLESS base price is now invalid and is archived with this
 *     reason before removal.
 *
 * `ADD VALUE IF NOT EXISTS` is idempotent, so this is safe on a database that
 * already has either value. Postgres cannot remove an enum value, so `down`
 * intentionally does nothing — leaving an unused label is harmless.
 */
export class PricingArchiveReasonGradedMigration1790100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."product_pricing_history_archived_reason_enum" ADD VALUE IF NOT EXISTS 'EXPIRED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."product_pricing_history_archived_reason_enum" ADD VALUE IF NOT EXISTS 'GRADED'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for an enum; the labels stay. Harmless.
  }
}
