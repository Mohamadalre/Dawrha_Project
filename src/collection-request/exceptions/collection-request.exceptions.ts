import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/** Named domain exceptions for the collection-request flow. */

// --- Requests ------------------------------------------------------------------
export class CollectionRequestNotFoundException extends NotFoundException {
  constructor(message = 'Collection request not found') {
    super({ message, errorCode: 'COLLECTION_REQUEST_NOT_FOUND' });
  }
}

export class CollectionRequestInvalidTransitionException extends ConflictException {
  constructor(message: string) {
    super({ message, errorCode: 'COLLECTION_REQUEST_INVALID_TRANSITION' });
  }
}

export class CollectionRequestNotCancellableException extends ConflictException {
  constructor() {
    super({
      message: 'This request can no longer be cancelled - the pickup has started',
      errorCode: 'COLLECTION_REQUEST_NOT_CANCELLABLE',
    });
  }
}

export class CollectionRequestNotOwnedException extends ForbiddenException {
  constructor() {
    super({
      message: 'This request does not belong to you',
      errorCode: 'COLLECTION_REQUEST_NOT_OWNED',
    });
  }
}

export class EmptyRequestLinesException extends BadRequestException {
  constructor() {
    super({
      message: 'A collection request needs at least one material',
      errorCode: 'EMPTY_COLLECTION_REQUEST_LINES',
    });
  }
}

export class DuplicateLineProductException extends BadRequestException {
  constructor() {
    super({
      message: 'The same material appears more than once - merge the quantities',
      errorCode: 'DUPLICATE_LINE_PRODUCT',
    });
  }
}

export class InvalidScheduleException extends BadRequestException {
  constructor() {
    super({
      message: 'The pickup slot must be in the future',
      errorCode: 'INVALID_SCHEDULE',
    });
  }
}

// --- Plans ---------------------------------------------------------------------
export class CollectionPlanNotFoundException extends NotFoundException {
  constructor(message = 'Collection plan not found') {
    super({ message, errorCode: 'COLLECTION_PLAN_NOT_FOUND' });
  }
}

export class CollectionPlanAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Your institution already has a collection plan - edit it instead',
      errorCode: 'COLLECTION_PLAN_ALREADY_EXISTS',
    });
  }
}

export class CollectionPlanNotOwnedException extends ForbiddenException {
  constructor() {
    super({
      message: 'This plan does not belong to you',
      errorCode: 'COLLECTION_PLAN_NOT_OWNED',
    });
  }
}

export class UnsupportedFrequencyException extends BadRequestException {
  constructor(message: string) {
    super({ message, errorCode: 'UNSUPPORTED_PLAN_FREQUENCY' });
  }
}

// --- Routes --------------------------------------------------------------------
export class CollectionRouteNotFoundException extends NotFoundException {
  constructor(message = 'Collection route not found') {
    super({ message, errorCode: 'COLLECTION_ROUTE_NOT_FOUND' });
  }
}

// --- Driver execution ----------------------------------------------------------
export class CollectionDriverProfileNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Driver profile not found',
      errorCode: 'COLLECTION_DRIVER_PROFILE_NOT_FOUND',
    });
  }
}

export class CollectionDriverNotEligibleException extends ConflictException {
  constructor() {
    super({
      message: 'This driver is not eligible for this request',
      errorCode: 'COLLECTION_DRIVER_NOT_ELIGIBLE',
    });
  }
}

export class CollectionCoveragePointNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Coverage point not found',
      errorCode: 'COLLECTION_COVERAGE_POINT_NOT_FOUND',
    });
  }
}

export class CollectionStopNotOnTourException extends NotFoundException {
  constructor() {
    super({
      message: 'This stop is not on your active tour',
      errorCode: 'COLLECTION_STOP_NOT_ON_TOUR',
    });
  }
}

export class CollectionActualWeightRequiredException extends BadRequestException {
  constructor() {
    super({
      message: 'A positive actual weight is required',
      errorCode: 'COLLECTION_ACTUAL_WEIGHT_REQUIRED',
    });
  }
}

export class CollectionWarehouseNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Delivery warehouse not found',
      errorCode: 'COLLECTION_DELIVERY_WAREHOUSE_NOT_FOUND',
    });
  }
}

// --- Offers (dispatch) ---------------------------------------------------------
export class CollectionOfferNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'No pending offer for this request',
      errorCode: 'COLLECTION_OFFER_NOT_FOUND',
    });
  }
}

export class CollectionOfferExpiredException extends ConflictException {
  constructor() {
    super({
      message: 'This offer has expired',
      errorCode: 'COLLECTION_OFFER_EXPIRED',
    });
  }
}
