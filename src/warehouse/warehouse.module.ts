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

import { DeliveryTariff }
from './entities/delivery-tariff.entity';

import { Product }
from '@src/waste-management/entities/product.entity';
import { MaterialCondition }
from '@src/waste-management/entities/material-condition.entity';

import { DeliveryQuoteService }
from './providers/delivery-quote.service';

import { DeliveryRate }
from './entities/delivery-rate.entity';

import { DeliveryRateService }
from './providers/delivery-rate.service';

import { DeliveryRateController }
from './delivery-rate.controller';

import { WarehouseAdminController }
from './warehouse-admin.controller';

import { InventoryController }
from './inventory.controller';

import { InventoryQueryService }
from './providers/inventory-query.service';

import { WasteCommonModule } from '@src/waste-management/common/waste-common.module';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { OrderPart } from '@src/order/entities/order-part.entity';
import { Province } from '@src/user/entities/location/province.entity';
import { OdooModule }
from '../odoo/odoo.module';

import { OdooSyncModule }
from '../odoo-sync/odoo-sync.module';

import { PermissionsModule }
from '../permission/permissions.module';
import { PlatformSettingsModule } from '@src/platform-settings/platform-settings.module';

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
      DeliveryTariff,
      // The per-kilometre rate the BACKEND admin authors. A separate table from
      // the Odoo tariff mirror above, which the sync job replaces wholesale — a
      // value written into that one would vanish on the next Odoo edit, with
      // nothing to trace.
      DeliveryRate,
      Product,
      // Grades belong to a material, and stock is held per grade — so a stock
      // response that wants to name one by id has to read them.
      MaterialCondition,
      TruckEntity,
      // A warehouse reports how many order shares it has been given, and orders
      // are placed on THIS side — Odoo only ever sees the parts pushed to it.
      OrderPart,
      // The governorate is REQUIRED on a warehouse and resolved to a real row
      // before anything is saved — a typed name cannot be checked against
      // anything. The service has taken this repository since that rule landed;
      // it was never registered here, so the container could not build the
      // service and the whole app refused to boot.
      Province,
    ]),

    OdooModule,
    WasteCommonModule,
    OdooSyncModule,
    PermissionsModule,
    PlatformSettingsModule,
  ],

  providers: [
    WarehouseAdminService,
    DeliveryQuoteService,
    DeliveryRateService,
    InventoryQueryService,
  ],

  controllers: [
    WarehouseAdminController,
    InventoryController,
    DeliveryRateController,
  ],

  // The order module prices delivery from the mirror Odoo authors.
  exports: [DeliveryQuoteService, DeliveryRateService, TypeOrmModule],
})

export class WarehouseModule {}
