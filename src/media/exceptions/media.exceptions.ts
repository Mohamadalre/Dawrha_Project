import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/** Named domain exceptions for the media module (see FIXES.md #34 convention). */
export class MediaNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Media not found', errorCode: 'MEDIA_NOT_FOUND' });
  }
}

export class OnlyRejectedReuploadException extends BadRequestException {
  constructor() {
    super({
      message: 'Only rejected images can be re-uploaded',
      errorCode: 'ONLY_REJECTED_REUPLOAD',
    });
  }
}

/**
 * Rejected, but nobody asked for a replacement.
 *
 * Rejection is silent by design — a reviewer marks a document unacceptable
 * while still working through the rest — so an account can carry a rejected
 * document its owner has never been told about and cannot see. Replacing one
 * unasked would bounce the account back into review mid-pass, over a change the
 * reviewer never requested.
 */
export class ReuploadNotRequestedException extends ConflictException {
  constructor() {
    super({
      message:
        'This document has not been requested from you — you will be notified if a replacement is needed',
      errorCode: 'REUPLOAD_NOT_REQUESTED',
    });
  }
}

/**
 * The DOCUMENT is outstanding but the APPLICATION is not waiting on anything.
 *
 * The two can disagree: an application already approved or rejected outright
 * may still carry a document with an open request. Replacing a file then would
 * reopen a decision that has been taken, from the applicant's side, without the
 * reviewer doing anything.
 */
export class AccountNotAwaitingChangesException extends ConflictException {
  constructor(status?: string) {
    super({
      message: status
        ? `Your application is ${status.toLowerCase().replace('_', ' ')}, so no document can be replaced right now`
        : 'Your application is not awaiting any changes right now',
      errorCode: 'ACCOUNT_NOT_AWAITING_CHANGES',
    });
  }
}

export class NotYourImageException extends ForbiddenException {
  constructor() {
    super({
      message: 'This image does not belong to your account',
      errorCode: 'NOT_YOUR_IMAGE',
    });
  }
}

export class DuplicateImageTypeException extends ForbiddenException {
  constructor(fileType: string) {
    super({
      message: `You already have a ${fileType} image. Update or delete it first.`,
      errorCode: 'DUPLICATE_IMAGE_TYPE',
    });
  }
}
