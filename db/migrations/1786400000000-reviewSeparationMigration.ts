import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two things the review flow was conflating.
 *
 * 1. `accounts.admin_note` — the reviewer's reason, kept apart from the
 *    applicant's own `description`.
 *
 *    They shared one column. `description` is written by the account holder in
 *    `PATCH /user/profile` and read straight back in `GET /user/profile`, so
 *    blocking somebody for suspected fraud printed the reason on their own
 *    profile screen — and left them free to overwrite it with anything. A note
 *    the subject can read is not internal, and one they can rewrite is not a
 *    record of anything.
 *
 *    Existing values are NOT copied across. A row's `description` today may be
 *    the holder's own bio or a reviewer's reason and nothing distinguishes
 *    them; moving them wholesale would publish bios as admin notes and, worse,
 *    delete the bios. The new column starts empty and fills from the next
 *    decision onward.
 *
 * 2. `media.reupload_requested_at` / `reupload_reason` — asking for a document
 *    again, kept apart from rejecting one.
 *
 *    Rejecting a document used to notify the applicant and push the whole
 *    account into NEED_CHANGES on the spot, so a reviewer could not mark one
 *    document bad while still working through the rest. These columns record
 *    the separate, deliberate request — and they are what decides when the
 *    applicant is finished, since an account can hold a rejected document
 *    nobody has asked about yet.
 */
export class ReviewSeparationMigration1786400000000
  implements MigrationInterface
{
  name = 'ReviewSeparationMigration1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "admin_note" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "reupload_requested_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "reupload_reason" text`,
    );

    // The review queue is read by "which documents are still outstanding for
    // this owner", on every listing and on every re-upload.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_media_owner_reupload_requested"
         ON "media" ("owner_id")
       WHERE "reupload_requested_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_media_owner_reupload_requested"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN IF EXISTS "reupload_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN IF EXISTS "reupload_requested_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" DROP COLUMN IF EXISTS "admin_note"`,
    );
  }
}
