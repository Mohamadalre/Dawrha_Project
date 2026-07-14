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
