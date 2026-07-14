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

export class WarehouseNotSyncedException extends BadRequestException {
  constructor() {
    super({ message: 'Warehouse is not synced to Odoo yet', errorCode: 'WAREHOUSE_NOT_SYNCED' });
  }
}
