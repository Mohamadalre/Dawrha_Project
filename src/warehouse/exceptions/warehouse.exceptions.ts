import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Named domain exceptions for the warehouse module (see FIXES.md #34 convention). */
export class WarehouseNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Warehouse not found', errorCode: 'WAREHOUSE_NOT_FOUND' });
  }
}

export class WarehouseCodeExistsException extends ConflictException {
  constructor() {
    super({ message: 'Warehouse code already exists', errorCode: 'WAREHOUSE_CODE_EXISTS' });
  }
}

/**
 * Two warehouses cannot share a name.
 *
 * The name is what every human uses: it is on the paperwork, on the shipment
 * screen, in the order the driver is handed. A duplicate is not a tidiness
 * problem — it is a load delivered to the wrong building by somebody who read
 * the right name.
 */
export class WarehouseNameExistsException extends ConflictException {
  constructor() {
    super({
      message: 'A warehouse with this name already exists',
      errorCode: 'WAREHOUSE_NAME_EXISTS',
    });
  }
}

/** The governorate given does not exist in `provinces`. */
export class WarehouseProvinceNotFoundException extends BadRequestException {
  constructor() {
    super({
      message: 'The chosen governorate does not exist',
      errorCode: 'WAREHOUSE_PROVINCE_NOT_FOUND',
    });
  }
}

export class WarehouseNotSyncedException extends BadRequestException {
  constructor() {
    super({ message: 'Warehouse is not synced to Odoo yet', errorCode: 'WAREHOUSE_NOT_SYNCED' });
  }
}
