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

/**
 * A material still held in a warehouse cannot be deleted.
 *
 * Deleting it would leave real, physical stock described by a catalogue entry
 * that no longer exists: the warehouse can see the material, the system cannot
 * name it, and no order can ever be raised to clear it. Reaching zero means
 * selling or writing it off — both decisions, not side effects of a delete.
 */
export class ProductHasStockException extends BadRequestException {
  constructor(name: string, remaining: number) {
    super({
      message:
        `"${name}" still has ${remaining} in warehouse stock and cannot be ` +
        'deleted. Sell or write off the remaining quantity first.',
      errorCode: 'PRODUCT_HAS_STOCK',
    });
  }
}

/** A material must be measured in something before it can be priced or sorted. */
export class UnitRequiredException extends BadRequestException {
  constructor() {
    super({
      message: 'A measurement unit is required. Send unit_id.',
      errorCode: 'UNIT_REQUIRED',
    });
  }
}

/**
 * `unit_id` and `unit_type` were both sent and name different units.
 *
 * Refused rather than resolved by precedence: either could have been what the
 * caller meant, and quietly picking one is how a material ends up measured in
 * kilograms and priced per piece.
 */
export class UnitMismatchException extends BadRequestException {
  constructor(fromId: string, fromCode: string) {
    super({
      message:
        `unit_id refers to "${fromId}" but unit_type says "${fromCode}". ` +
        'Send one, or send both agreeing.',
      errorCode: 'UNIT_MISMATCH',
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
