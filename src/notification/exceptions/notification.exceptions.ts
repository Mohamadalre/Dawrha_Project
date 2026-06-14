import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

export class NotificationNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Notification with id ${id} not found`);
  }
}

export class NotificationDeliveryException extends InternalServerErrorException {
  constructor(reason: string) {
    super(`Notification delivery failed: ${reason}`);
  }
}

export class NotificationValidationException extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}
