import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OdooModule } from '@src/odoo/odoo.module';
import { NotificationModule } from '@src/notification/notification.module';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { Account } from '@src/user/entities/account.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';
import { MaterialCondition } from '@src/waste-management/entities/material-condition.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { ShiftChangeRequest } from '@src/truck/entities/shift-change-request.entity';
import { Shift } from '@src/shift/entities/shift.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { ODOO_SYNC_QUEUE } from './odoo-sync.constants';
import { OdooSyncService } from './odoo-sync.service';
import { OdooSyncProcessor } from './odoo-sync.processor';
import { OdooWebhookController } from './odoo-webhook.controller';

@Module({
  imports: [
    OdooModule,
    NotificationModule,
    BullModule.registerQueue({ name: ODOO_SYNC_QUEUE }),
    TypeOrmModule.forFeature([
      WasteCategory,
      Product,
      ProductPricing,
      Account,
      Warehouse,
      WarehouseInventory,
      MeasurementUnit,
      MaterialCondition,
      TruckEntity,
      TruckAssignmentEntity,
      ShiftChangeRequest,
      Shift,
      CollectorProfile,
    ]),
  ],
  controllers: [OdooWebhookController],
  providers: [OdooSyncService, OdooSyncProcessor],
  exports: [OdooSyncService],
})
export class OdooSyncModule {}
