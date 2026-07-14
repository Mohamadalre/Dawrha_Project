import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

/** Named domain exceptions for the user module (see FIXES.md #34 convention). */
export class AccountNotFoundException extends NotFoundException {
  constructor(message = 'Account not found') {
    super({ message, errorCode: 'ACCOUNT_NOT_FOUND' });
  }
}

export class AccountNotActiveException extends ForbiddenException {
  constructor() {
    super({
      message: 'Account must be active to update profile info',
      errorCode: 'ACCOUNT_NOT_ACTIVE',
    });
  }
}

export class PhoneAlreadyExistsException extends BadRequestException {
  constructor() {
    super({ message: 'The phone already exists', errorCode: 'PHONE_ALREADY_EXISTS' });
  }
}

export class PasswordConfirmationMismatchException extends BadRequestException {
  constructor() {
    super({
      message: 'Password confirmation does not match',
      errorCode: 'PASSWORD_CONFIRMATION_MISMATCH',
    });
  }
}

export class NoPasswordSetException extends BadRequestException {
  constructor() {
    super({
      message: 'This account has no password set (e.g. social login)',
      errorCode: 'NO_PASSWORD_SET',
    });
  }
}

export class IncorrectPasswordException extends BadRequestException {
  constructor() {
    super({ message: 'Current password is incorrect', errorCode: 'INCORRECT_PASSWORD' });
  }
}

export class SamePasswordException extends BadRequestException {
  constructor() {
    super({
      message: 'The new password must be different from the current one',
      errorCode: 'SAME_PASSWORD',
    });
  }
}

export class CitizenOnlyLocationsException extends ForbiddenException {
  constructor() {
    super({
      message: 'Only individual users can manage multiple locations',
      errorCode: 'CITIZEN_ONLY_LOCATIONS',
    });
  }
}

export class InvalidProvinceException extends BadRequestException {
  constructor() {
    super({ message: 'Invalid province', errorCode: 'INVALID_PROVINCE' });
  }
}

export class LocationNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Location not found', errorCode: 'LOCATION_NOT_FOUND' });
  }
}

export class NotYourLocationException extends ForbiddenException {
  constructor() {
    super({
      message: 'This location does not belong to your account',
      errorCode: 'NOT_YOUR_LOCATION',
    });
  }
}
