import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Named domain exceptions for the waste-management marketplace.
 *
 * Each extends the matching Nest HTTP exception (so `instanceof` checks and
 * existing specs keep working) and carries a stable machine-readable
 * `errorCode` that AllExceptionsFilter surfaces in the unified envelope.
 * Messages are the exact literals already present in the i18n dictionaries.
 */

// --- Categories --------------------------------------------------------------
export class CategoryNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Category not found', errorCode: 'CATEGORY_NOT_FOUND' });
  }
}

export class CategoryAlreadyExistsException extends BadRequestException {
  constructor() {
    super({ message: 'Category already exists', errorCode: 'CATEGORY_ALREADY_EXISTS' });
  }
}

export class CategoryHasProductsException extends BadRequestException {
  constructor() {
    super({
      message: 'Cannot delete a category that still has products',
      errorCode: 'CATEGORY_HAS_PRODUCTS',
    });
  }
}

/** Anti-enumeration: restricted accounts see a 404, not a 403, for foreign categories. */
export class CategoryNotAccessibleException extends NotFoundException {
  constructor() {
    super({
      message: 'Category not available for this account',
      errorCode: 'CATEGORY_NOT_ACCESSIBLE',
    });
  }
}

// --- Products ------------------------------------------------------------------
export class ProductNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Product not found', errorCode: 'PRODUCT_NOT_FOUND' });
  }
}

export class ProductInCartsException extends BadRequestException {
  constructor() {
    super({
      message: 'Cannot delete a product that is in active carts',
      errorCode: 'PRODUCT_IN_ACTIVE_CARTS',
    });
  }
}

export class OfferNotAvailableException extends BadRequestException {
  constructor() {
    super({
      message: 'Offer not available for your account type',
      errorCode: 'OFFER_NOT_AVAILABLE',
    });
  }
}

export class OfferNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Offer not found', errorCode: 'OFFER_NOT_FOUND' });
  }
}

// --- Measurement units ---------------------------------------------------------
export class UnitNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Unit not found', errorCode: 'UNIT_NOT_FOUND' });
  }
}

export class UnitAlreadyExistsException extends ConflictException {
  constructor() {
    super({ message: 'Unit already exists', errorCode: 'UNIT_ALREADY_EXISTS' });
  }
}

export class UnitInUseException extends BadRequestException {
  constructor() {
    super({
      message: 'Cannot delete a unit that is used by products — deactivate it instead',
      errorCode: 'UNIT_IN_USE',
    });
  }
}

export class UnitUsedByActiveProductsException extends BadRequestException {
  constructor() {
    super({
      message: 'Cannot deactivate a unit that is used by active products',
      errorCode: 'UNIT_USED_BY_ACTIVE_PRODUCTS',
    });
  }
}

export class InvalidUnitCodeException extends BadRequestException {
  constructor(allowedCodes: string[]) {
    super({
      message: `Invalid unit type. Allowed units: ${allowedCodes.join(', ')}`,
      errorCode: 'INVALID_UNIT_CODE',
    });
  }
}

// --- Material conditions ---------------------------------------------------------
export class ConditionNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Condition not found', errorCode: 'CONDITION_NOT_FOUND' });
  }
}

export class ConditionAlreadyExistsException extends ConflictException {
  constructor() {
    super({ message: 'Condition already exists', errorCode: 'CONDITION_ALREADY_EXISTS' });
  }
}

export class ConditionInUseException extends BadRequestException {
  constructor() {
    super({
      message: 'Cannot delete a condition that is used by pricing or stock — deactivate it instead',
      errorCode: 'CONDITION_IN_USE',
    });
  }
}

export class InvalidConditionCodeException extends BadRequestException {
  constructor(allowedCodes: string[]) {
    super({
      message: `Invalid condition code. Allowed conditions: ${allowedCodes.join(', ')}`,
      errorCode: 'INVALID_CONDITION_CODE',
    });
  }
}

export class ConditionRequiredException extends BadRequestException {
  constructor() {
    super({
      message: 'A material condition is required for this product at your price tier',
      errorCode: 'CONDITION_REQUIRED',
    });
  }
}

// --- My materials ---------------------------------------------------------------
export class MaterialsNotApplicableException extends ForbiddenException {
  constructor() {
    super({
      message: 'Only factories, free facilities and institutions have onboarding materials',
      errorCode: 'MATERIALS_NOT_APPLICABLE',
    });
  }
}
