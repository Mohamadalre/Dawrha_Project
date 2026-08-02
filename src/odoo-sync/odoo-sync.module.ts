import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OdooModule } from '@src/odoo/odoo.module';
import { NotificationModule } from '@src/notification/notification.module';
import { SuggestionsModule } from '@src/waste-management/suggestions/suggestions.module';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { Account } from '@src/user/entities/account.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { WarehouseManager } from '@src/warehouse/entities/warehouse-manager.entity';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';
import { MaterialCondition } from '@src/waste-management/entities/material-condition.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { ShiftChangeRequest } from '@src/truck/entities/shift-change-request.entity';
import { TruckProblem } from '@src/truck/entities/truck-problem.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { Shift } from '@src/shift/entities/shift.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { Media } from '@src/media/entities/media.entity';
import { Province } from '@src/user/entities/location/province.entity';
import { DeliveryTariff } from '@src/warehouse/entities/delivery-tariff.entity';
import { Order } from '@src/order/entities/order.entity';
import { OrderPart } from '@src/order/entities/order-part.entity';
import { DistanceCache } from '@src/order/entities/distance-cache.entity';
import { ODOO_SYNC_QUEUE } from './odoo-sync.constants';
import { OdooSyncService } from './odoo-sync.service';
import { OdooSyncProcessor } from './odoo-sync.processor';
import { FleetReconcileService } from './fleet-reconcile.service';
import { DriverRequestReconcileService } from './driver-request-reconcile.service';
import { PushReconcileService } from './push-reconcile.service';
import { ProvinceReconcileService } from './province-reconcile.service';
import { DeliveryTariffReconcileService } from './delivery-tariff-reconcile.service';
import { OdooWebhookController } from './odoo-webhook.controller';

@Module({
  imports: [
    OdooModule,
    NotificationModule,
    // The product-suggestion webhook files an Odoo proposal through the same
    // service the app's own suggestion endpoint uses.
    SuggestionsModule,
    BullModule.registerQueue({ name: ODOO_SYNC_QUEUE }),
    TypeOrmModule.forFeature([
      WasteCategory,
      Product,
      ProductPricing,
      Account,
      Warehouse,
      WarehouseInventory,
      WarehouseManager,
      MeasurementUnit,
      MaterialCondition,
      TruckEntity,
      TruckAssignmentEntity,
      ShiftChangeRequest,
      TruckProblem,
      TruckHandover,
      Shift,
      CollectorProfile,
      UserDevice,
      Media,
      Province,
      DeliveryTariff,
      Order,
      OrderPart,
      DistanceCache,
    ]),
  ],
  controllers: [OdooWebhookController],
  providers: [
    OdooSyncService,
    OdooSyncProcessor,
    FleetReconcileService,
    DriverRequestReconcileService,
    PushReconcileService,
    ProvinceReconcileService,
    DeliveryTariffReconcileService,
  ],
  exports: [OdooSyncService],
})
export class OdooSyncModule {}
