import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Named domain exceptions for the notification module. Each carries a stable
 * `errorCode` surfaced by AllExceptionsFilter in the unified envelope.
 */
export class NotificationNotFoundException extends NotFoundException {
  constructor(id: string) {
    super({
      message: `Notification with id ${id} not found`,
      errorCode: 'NOTIFICATION_NOT_FOUND',
    });
  }
}

export class NotificationDeliveryException extends InternalServerErrorException {
  constructor(reason: string) {
    super({
      message: `Notification delivery failed: ${reason}`,
      errorCode: 'NOTIFICATION_DELIVERY_FAILED',
    });
  }
}

export class NotificationValidationException extends BadRequestException {
  constructor(message: string) {
    super({ message, errorCode: 'NOTIFICATION_VALIDATION_FAILED' });
  }
}
