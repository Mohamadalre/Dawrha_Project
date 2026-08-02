import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Named domain exceptions for admin account management (see FIXES.md #34 convention). */
export class DriverManagedInOdooException extends BadRequestException {
  constructor() {
    super({
      message: 'Driver accounts are managed in Odoo — use the Odoo admin for this action',
      errorCode: 'DRIVER_MANAGED_IN_ODOO',
    });
  }
}

export class ProfileNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Profile not found', errorCode: 'PROFILE_NOT_FOUND' });
  }
}

export class InvalidIdException extends BadRequestException {
  /** message: 'Invalid media ID' | 'Invalid account ID' | 'Invalid profile ID' */
  constructor(message: string) {
    super({ message, errorCode: 'INVALID_ID' });
  }
}

export class AdminAccountNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Account not found', errorCode: 'ACCOUNT_NOT_FOUND' });
  }
}

export class NoMediaForProfileException extends NotFoundException {
  constructor() {
    super({ message: 'No media found for this profile', errorCode: 'NO_MEDIA_FOR_PROFILE' });
  }
}

export class MediaAlreadyReviewedException extends ConflictException {
  constructor(status: string) {
    super({
      message: `Media is already ${status.toLowerCase()}. Only pending media can be reviewed`,
      errorCode: 'MEDIA_ALREADY_REVIEWED',
    });
  }
}

/**
 * A document cannot be re-judged once the ACCOUNT has been decided.
 *
 * An approved account is settled: its documents are the evidence the approval
 * rests on, and re-marking one afterwards rewrites the basis of a decision
 * already acted upon. A rejected account is settled the same way — but it can
 * be re-opened, and the way back is to ASK for the document again
 * (`request-reupload`), which replaces the file instead of quietly relabelling
 * the one on record.
 */
export class DocumentsFrozenException extends ConflictException {
  // No status spliced into the sentence: the error filter translates by exact
  // match on the whole message, so anything interpolated reaches an Arabic
  // caller in English. The caller already knows the status — it is on the
  // account they just read.
  constructor(_status: string) {
    super({
      message:
        'This account has already been decided, so its documents can no longer be re-judged. To re-open it, request the document again',
      errorCode: 'DOCUMENTS_FROZEN',
    });
  }
}

/** Only a rejected document can be asked for again. */
export class ReuploadNeedsRejectedDocumentException extends ConflictException {
  constructor(_status: string) {
    super({
      message:
        'Only a rejected document can be requested again — reject it first, so there is a recorded reason the applicant can be given',
      errorCode: 'REUPLOAD_NEEDS_REJECTED_DOCUMENT',
    });
  }
}

/** The same document asked for twice, with the applicant yet to answer once. */
export class ReuploadAlreadyRequestedException extends ConflictException {
  constructor() {
    super({
      message: 'This document has already been requested — the applicant has not replaced it yet',
      errorCode: 'REUPLOAD_ALREADY_REQUESTED',
    });
  }
}

/** A document cannot be requested from an account that is not under review. */
export class ReuploadNotReviewableException extends ConflictException {
  constructor(_status: string) {
    super({
      message: 'Documents can only be requested from an account that is still under review',
      errorCode: 'REUPLOAD_NOT_REVIEWABLE',
    });
  }
}

/**
 * No decision while the applicant has been sent away to fix something.
 *
 * The reviewer asked for a document and the applicant has not answered yet.
 * Deciding now judges an application that is, by the reviewer's own account,
 * incomplete.
 */
export class AccountAwaitingApplicantException extends ConflictException {
  constructor() {
    super({
      message: 'This account was asked to re-upload a document and has not done so yet, so it cannot be approved or rejected until the applicant answers',
      errorCode: 'ACCOUNT_AWAITING_APPLICANT',
    });
  }
}

/** Approving over a document the reviewer themselves marked unacceptable. */
export class ApprovalBlockedByRejectedDocumentException extends ConflictException {
  constructor(_count: number) {
    super({
      message: 'Some documents on this account are rejected. Approve them, or request them again, before approving the account',
      errorCode: 'APPROVAL_BLOCKED_BY_REJECTED_DOCUMENT',
    });
  }
}

/** Rejecting while documents are still unread. */
export class RejectionNeedsEveryDocumentJudgedException extends ConflictException {
  constructor(_count: number) {
    super({
      message: 'Some documents on this account have not been reviewed. Approve or reject each of them before rejecting the account',
      errorCode: 'REJECTION_NEEDS_EVERY_DOCUMENT_JUDGED',
    });
  }
}

/** An approved account is final — the one decision that cannot be taken back. */
export class ApprovedAccountIsFinalException extends ConflictException {
  constructor() {
    super({
      message: 'This account is already approved. An approval cannot be withdrawn — block the account instead',
      errorCode: 'APPROVED_ACCOUNT_IS_FINAL',
    });
  }
}

/**
 * Nothing to stop waiting for.
 *
 * Cancelling is the reviewer withdrawing a question they asked. If they never
 * asked one, the account is not stuck on them and the button is a no-op that
 * would silently move an account between statuses for no reason.
 */
export class NothingRequestedException extends ConflictException {
  constructor() {
    super({
      message: 'This account has not been asked for any document, so there is nothing to cancel',
      errorCode: 'NOTHING_REQUESTED',
    });
  }
}

/** Blocking is for accounts that are actually in use. */
export class BlockNeedsApprovedAccountException extends ConflictException {
  constructor(_status: string) {
    super({
      message: 'Only an approved account can be blocked',
      errorCode: 'BLOCK_NEEDS_APPROVED_ACCOUNT',
    });
  }
}

export class MediaViewNotPendingException extends ConflictException {
  constructor(status: string) {
    super({
      message: `Account is ${status.toLowerCase().replace('_', ' ')}. Media can only be viewed for pending approval accounts`,
      errorCode: 'ACCOUNT_NOT_PENDING_APPROVAL',
    });
  }
}

export class AccountAlreadyProcessedException extends ConflictException {
  constructor(status: string) {
    super({
      message: `Account already ${status.toLowerCase().replace('_', ' ')}. Cannot update status again`,
      errorCode: 'ACCOUNT_ALREADY_PROCESSED',
    });
  }
}

export class CannotBlockPendingException extends BadRequestException {
  constructor() {
    super({
      message: 'Cannot block a pending approval account. Use the block-status endpoint',
      errorCode: 'CANNOT_BLOCK_PENDING',
    });
  }
}

export class MediaReviewIncompleteException extends ConflictException {
  constructor() {
    super({
      message: 'All media must be reviewed before approving or rejecting the account',
      errorCode: 'MEDIA_REVIEW_INCOMPLETE',
    });
  }
}

export class AccountAlreadyInStatusException extends ConflictException {
  constructor(current: string) {
    super({
      message: `Account is already ${current.toLowerCase().replace('_', ' ')}`,
      errorCode: 'ACCOUNT_ALREADY_IN_STATUS',
    });
  }
}

export class InvalidStatusTransitionException extends BadRequestException {
  constructor(current: string, target: string) {
    super({
      message: `Cannot change status from ${current.toLowerCase().replace('_', ' ')} to ${target.toLowerCase().replace('_', ' ')}. Only ACTIVE↔BLOCKED transitions are allowed`,
      errorCode: 'INVALID_STATUS_TRANSITION',
    });
  }
}
