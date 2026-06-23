import { Module } from '@nestjs/common';

import { TypeOrmModule }
from '@nestjs/typeorm';

import { Warehouse }
from './entities/warehouse.entity';

import { WarehouseManager }
from './entities/warehouse-manager.entity';

import { WarehouseInventory }
from './entities/warehouse-inventory.entity';

import { WarehouseAdminService }
from './warehouse-admin.service';

import { WarehouseAdminController }
from './warehouse-admin.controller';

import { OdooModule }
from '../odoo/odoo.module';

import { OdooSyncModule }
from '../odoo-sync/odoo-sync.module';

import { PermissionsModule }
from '../permission/permissions.module';

/**
 * Warehouses and their managers are created INSIDE Odoo, not via this backend.
 * This module only mirrors them locally (import-odoo) and exposes read + sync
 * APIs — there is intentionally no warehouse/manager creation endpoint here.
 */
@Module({
  imports: [

    TypeOrmModule.forFeature([
      Warehouse,
      WarehouseManager,
      WarehouseInventory,
    ]),

    OdooModule,
    OdooSyncModule,
    PermissionsModule,
  ],

  providers: [
    WarehouseAdminService,
  ],

  controllers: [
    WarehouseAdminController,
  ],
})

export class WarehouseModule {}
