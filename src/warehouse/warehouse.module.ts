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
 * Warehouses are authored in THIS backend (POST /admin/warehouses) and pushed to
 * Odoo by a background job; if the Odoo creation fails the job compensates by
 * removing the local row. Managers are still assigned inside Odoo and mirrored
 * back here (sync-manager / import-odoo). The module also exposes read + inventory
 * sync APIs.
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
