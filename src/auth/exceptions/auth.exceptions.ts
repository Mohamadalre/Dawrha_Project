import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Named domain exceptions for the auth module.
 *
 * Each extends the matching Nest HTTP exception (so `instanceof` checks and
 * guards keep working) and carries a stable machine-readable `errorCode` that
 * AllExceptionsFilter surfaces in the unified envelope. Messages are the exact
 * literals already present in `src/i18n/{ar,en}/translation.json`.
 */
export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({ message: 'Invalid credentials', errorCode: 'INVALID_CREDENTIALS' });
  }
}

export class AppNotAuthorizedException extends UnauthorizedException {
  constructor() {
    super({
      message: 'This account is not authorized for this application',
      errorCode: 'APP_NOT_AUTHORIZED',
    });
  }
}

export class EmailAlreadyExistsException extends BadRequestException {
  constructor(message = 'The email already exists') {
    super({ message, errorCode: 'EMAIL_ALREADY_EXISTS' });
  }
}

export class PhoneAlreadyExistsException extends BadRequestException {
  constructor() {
    super({ message: 'The phone already exists', errorCode: 'PHONE_ALREADY_EXISTS' });
  }
}

export class InvalidOtpException extends BadRequestException {
  constructor() {
    super({
      message: 'The verification code is incorrect or expired',
      errorCode: 'INVALID_OTP',
    });
  }
}

export class InvalidTokenException extends UnauthorizedException {
  constructor(message = 'Invalid Token') {
    super({ message, errorCode: 'INVALID_TOKEN' });
  }
}

export class InvalidResetTicketException extends BadRequestException {
  constructor() {
    super({ message: 'Invalid or expired token', errorCode: 'INVALID_RESET_TICKET' });
  }
}

export class PasswordMismatchException extends BadRequestException {
  constructor() {
    super({ message: 'Passwords do not match', errorCode: 'PASSWORD_MISMATCH' });
  }
}

export class AccountNotFoundException extends NotFoundException {
  constructor(message = 'Account not found.') {
    super({ message, errorCode: 'ACCOUNT_NOT_FOUND' });
  }
}

export class DeviceNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Device not found.', errorCode: 'DEVICE_NOT_FOUND' });
  }
}
