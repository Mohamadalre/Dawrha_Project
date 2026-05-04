import { PipeTransform, BadRequestException } from '@nestjs/common';
import { validate as isUUID } from 'uuid';

export class ValidateUUIDPipe implements PipeTransform {
  transform(value: string) {
    if (!isUUID(value)) {
      throw new BadRequestException('Invalid UUID');
    }
    return value;
  }
}