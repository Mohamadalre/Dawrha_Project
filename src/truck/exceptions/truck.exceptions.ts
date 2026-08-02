import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/** Named domain exceptions for trucks / assignments / shift-change requests. */

// --- Trucks -------------------------------------------------------------------
export class TruckNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Truck not found', errorCode: 'TRUCK_NOT_FOUND' });
  }
}

export class TruckPlateExistsException extends ConflictException {
  constructor(message = 'Truck plate number already exists') {
    super({ message, errorCode: 'TRUCK_PLATE_EXISTS' });
  }
}

export class MechanicsImageUploadException extends BadRequestException {
  constructor() {
    super({
      message: 'Failed to upload the mechanics image',
      errorCode: 'MECHANICS_IMAGE_UPLOAD_FAILED',
    });
  }
}

export class TruckHasDriversStatusException extends BadRequestException {
  constructor() {
    super({
      message: 'A truck with assigned drivers cannot change status; remove the assignment(s) first',
      errorCode: 'TRUCK_HAS_DRIVERS',
    });
  }
}

export class TruckDisabledException extends BadRequestException {
  constructor(message = 'Truck is disabled and cannot take drivers') {
    super({ message, errorCode: 'TRUCK_DISABLED' });
  }
}

export class TruckFullyBusyException extends BadRequestException {
  constructor() {
    super({ message: 'Truck is fully busy', errorCode: 'TRUCK_FULLY_BUSY' });
  }
}

// --- Drivers & assignments -----------------------------------------------------
export class DriverNotFoundException extends NotFoundException {
  constructor(message = 'Driver not found') {
    super({ message, errorCode: 'DRIVER_NOT_FOUND' });
  }
}

export class DriverAlreadyAssignedException extends ConflictException {
  constructor() {
    super({
      message: 'Driver is already assigned to a truck',
      errorCode: 'DRIVER_ALREADY_ASSIGNED',
    });
  }
}

export class AssignmentShiftNotFoundException extends BadRequestException {
  constructor() {
    super({ message: 'Shift not found', errorCode: 'SHIFT_NOT_FOUND' });
  }
}

export class TruckShiftTakenException extends ConflictException {
  constructor(message = 'This truck already has a driver on the selected shift') {
    super({ message, errorCode: 'TRUCK_SHIFT_TAKEN' });
  }
}

export class NoAssignmentException extends NotFoundException {
  constructor() {
    super({
      message: 'This driver has no truck assignment',
      errorCode: 'NO_TRUCK_ASSIGNMENT',
    });
  }
}

// --- Shift-change requests -------------------------------------------------------
export class DriverInactiveException extends ForbiddenException {
  constructor() {
    super({
      message: 'Your account must be active to request a shift change',
      errorCode: 'DRIVER_INACTIVE',
    });
  }
}

export class ActiveShiftChangeExistsException extends ConflictException {
  constructor() {
    super({
      message: 'You already have an active shift-change request',
      errorCode: 'ACTIVE_SHIFT_CHANGE_EXISTS',
    });
  }
}

export class ShiftChangeRequestNotFoundException extends NotFoundException {
  constructor(message = 'Request not found') {
    super({ message, errorCode: 'SHIFT_CHANGE_REQUEST_NOT_FOUND' });
  }
}

export class NotYourRequestException extends ForbiddenException {
  constructor() {
    super({
      message: 'This request does not belong to you',
      errorCode: 'NOT_YOUR_REQUEST',
    });
  }
}

export class ShiftChangeStateException extends BadRequestException {
  /** All invalid state-transition guards share one code; message says which rule. */
  constructor(message: string) {
    super({ message, errorCode: 'SHIFT_CHANGE_INVALID_STATE' });
  }
}

// --- Truck handover (pickup / dropoff) ------------------------------------------
export class PickupBeforeShiftException extends BadRequestException {
  constructor() {
    super({
      message: 'You cannot pick up the truck before your shift starts',
      errorCode: 'PICKUP_BEFORE_SHIFT',
    });
  }
}

export class PickupAfterShiftException extends BadRequestException {
  constructor() {
    super({
      message: 'Your shift has ended — you can no longer pick up the truck',
      errorCode: 'PICKUP_AFTER_SHIFT',
    });
  }
}

export class DropoffBeforeShiftEndException extends BadRequestException {
  constructor() {
    super({
      message: 'You can only hand the truck back after your shift ends (unless it is out of service)',
      errorCode: 'DROPOFF_BEFORE_SHIFT_END',
    });
  }
}

export class TruckAlreadyHeldException extends ConflictException {
  constructor() {
    super({
      message: 'You are already holding a truck — hand it back first',
      errorCode: 'TRUCK_ALREADY_HELD',
    });
  }
}

export class TruckHeldByOtherException extends ConflictException {
  constructor() {
    super({
      message: 'The previous driver has not handed this truck back yet',
      errorCode: 'TRUCK_HELD_BY_OTHER',
    });
  }
}

export class NoOpenHandoverException extends NotFoundException {
  constructor() {
    super({
      message: 'You are not currently holding a truck',
      errorCode: 'NO_OPEN_HANDOVER',
    });
  }
}

export class DropoffReasonRequiredException extends BadRequestException {
  constructor() {
    super({
      message: 'Please record a note about the truck before handing it back',
      errorCode: 'DROPOFF_REASON_REQUIRED',
    });
  }
}

export class SameShiftRequestException extends BadRequestException {
  constructor() {
    super({
      message: 'You are already on this shift — pick a different one',
      errorCode: 'SAME_SHIFT_REQUEST',
    });
  }
}

export class ShiftNotInYourWarehouseException extends BadRequestException {
  constructor() {
    super({
      message: 'You can only request shifts of your own warehouse',
      errorCode: 'SHIFT_NOT_IN_YOUR_WAREHOUSE',
    });
  }
}

export class DriverHasNoTruckException extends BadRequestException {
  constructor() {
    super({
      message: 'You must be assigned to a truck before requesting a shift change',
      errorCode: 'DRIVER_HAS_NO_TRUCK',
    });
  }
}
