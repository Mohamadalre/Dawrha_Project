import { NotFoundException } from '@nestjs/common';

/** Named domain exceptions for the shift module (see FIXES.md #34 convention). */
export class ShiftNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Shift not found', errorCode: 'SHIFT_NOT_FOUND' });
  }
}

/** The authenticated collector has no driver profile yet. */
export class DriverProfileNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Driver profile not found', errorCode: 'DRIVER_PROFILE_NOT_FOUND' });
  }
}
