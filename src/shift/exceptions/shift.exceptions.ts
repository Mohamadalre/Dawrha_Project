import { NotFoundException } from '@nestjs/common';

/** Named domain exceptions for the shift module (see FIXES.md #34 convention). */
export class ShiftNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Shift not found', errorCode: 'SHIFT_NOT_FOUND' });
  }
}
