import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AccountStatus } from '@src/user/enums/account-status.enum';

/**
 * Decisions an admin may take directly on an ACCOUNT.
 *
 * Two statuses only.
 *
 * NEED_CHANGES is not here: it is not a decision anyone takes on an account,
 * it is what happens when a specific document is asked for again. Setting it
 * directly would leave the applicant told to fix something with nothing marked
 * as needing fixing — and the re-upload route, which only accepts a document
 * that was actually requested, would refuse every file they sent.
 *
 * BLOCKED is not here either: it has its own route, because it is not part of
 * the same question. Approve/reject decides whether an applicant may join;
 * blocking is what happens to a member who already has.
 */
const DECISIONS = [AccountStatus.ACTIVE, AccountStatus.REJECTED];

export class UpdateAccountStatusDto {
  @IsIn(DECISIONS)
  @IsNotEmpty()
  status: AccountStatus;

  /**
   * Why.
   *
   * Recorded on the account as the REVIEWER's note, in a column the account
   * holder can neither read nor edit — and sent to them in the rejection
   * notice, which is the only place they see it. A rejection nobody can
   * explain later is a decision with no author.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class BlockedAccountStatusDto {
  @IsIn([AccountStatus.ACTIVE, AccountStatus.BLOCKED])
  @IsNotEmpty()
  status: AccountStatus;

  /**
   * The block reason — for the ADMIN, not for the blocked account.
   *
   * Stored in `admin_note` and shown only in the blocked-accounts listing. The
   * blocked user is told they are blocked and to contact support; telling them
   * the reason tells whoever is abusing the platform exactly which signal
   * caught them, which is the one piece of information that helps them evade
   * it next time.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

/** Asking an applicant for one document again. */
export class RequestReuploadDto {
  /**
   * What is wrong with it. Optional, but meant to be filled: this is the
   * entire content of the message the applicant receives, and "re-upload your
   * licence" without saying why produces the same unreadable scan twice.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/**
 * Withdrawing every outstanding document request on one account.
 *
 * Account-level rather than per-document on purpose. Accepting a document
 * already closes the request for it, so the only thing that was missing is
 * "stop waiting for this applicant altogether" — and that is a fact about the
 * application, not about one file. Cancelling one of three requests would also
 * do nothing visible, since the account stays blocked on the other two, which
 * is a button that appears to fail.
 */
export class CancelReuploadRequestsDto {
  /**
   * Why the reviewer stopped waiting. Goes to the applicant, because they are
   * looking at a screen telling them to upload something that is no longer
   * wanted, and silence would leave it there.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/** Listing a role's accounts, filtered by status. */
export class AccountListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;

  /**
   * Omitted means EVERY status — this listing is the general-purpose window
   * onto a role, and the review queue has its own route with its own ordering.
   */
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}
