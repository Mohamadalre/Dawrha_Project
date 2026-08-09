import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `role_specific` to `offers`.
 *
 * A role-specific offer may now sit ALONGSIDE a general (audience-wide) one that
 * also reaches the role, and it overrides the general for that role — the buyer
 * is shown the specific offer, not the general. This flag is what tells the two
 * apart: `false` = general (no target_roles named on create), `true` = the admin
 * targeted the role explicitly.
 *
 * Existing rows default to `false` (general). Rows created before role targeting
 * that DID carry target_roles keep working — the flag only changes how a clash
 * is judged and which of two overlapping offers a buyer is shown; an existing
 * lone offer is unaffected either way.
 */
export class OfferRoleSpecificMigration1788200000000 implements MigrationInterface {
  name = 'OfferRoleSpecificMigration1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "role_specific" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offers" DROP COLUMN IF EXISTS "role_specific"`);
  }
}
