import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for domain (business) exceptions.
 *
 * Carries a stable machine-readable `errorCode` the frontends can switch on,
 * while the human-readable `message` is translated per-request by the global
 * AllExceptionsFilter. Response shape stays the unified envelope:
 *   { success:false, message, errorCode, data:null, statusCode, timestamp }
 */
export class AppException extends HttpException {
  constructor(
    message: string,
    statusCode: HttpStatus,
    public readonly errorCode: string,
  ) {
    super({ message, errorCode }, statusCode);
  }
}

/** 400 — the request is valid but violates a domain rule. */
export class BusinessRuleException extends AppException {
  constructor(message: string, errorCode = 'BUSINESS_RULE_VIOLATION') {
    super(message, HttpStatus.BAD_REQUEST, errorCode);
  }
}

/** 404 — a referenced domain resource does not exist (or is hidden from the caller). */
export class ResourceNotFoundException extends AppException {
  constructor(message: string, errorCode = 'RESOURCE_NOT_FOUND') {
    super(message, HttpStatus.NOT_FOUND, errorCode);
  }
}

/** 409 — uniqueness/state conflict (duplicate code, already-reviewed request, ...). */
export class DuplicateResourceException extends AppException {
  constructor(message: string, errorCode = 'DUPLICATE_RESOURCE') {
    super(message, HttpStatus.CONFLICT, errorCode);
  }
}

/** 403 — the caller's role/ownership does not allow this action. */
export class ForbiddenActionException extends AppException {
  constructor(message: string, errorCode = 'FORBIDDEN_ACTION') {
    super(message, HttpStatus.FORBIDDEN, errorCode);
  }
}

/** 502 — an upstream dependency (Odoo, Cloudinary, ...) failed. */
export class ExternalServiceException extends AppException {
  constructor(message: string, errorCode = 'EXTERNAL_SERVICE_ERROR') {
    super(message, HttpStatus.BAD_GATEWAY, errorCode);
  }
}
