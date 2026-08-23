import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OdooModule } from '@src/odoo/odoo.module';
import { NotificationModule } from '@src/notification/notification.module';
import { PlatformSettingsModule } from '@src/platform-settings/platform-settings.module';
import { SuggestionsModule } from '@src/waste-management/suggestions/suggestions.module';
import { WasteCommonModule } from '@src/waste-management/common/waste-common.module';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { Offer } from '@src/waste-management/entities/offer.entity';
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
import { OrderPartOffer } from '@src/order/entities/order-part-offer.entity';
import { DeliveryRateService } from '@src/warehouse/providers/delivery-rate.service';
import { DeliveryRate } from '@src/warehouse/entities/delivery-rate.entity';
import { DistanceCache } from '@src/order/entities/distance-cache.entity';
import { ODOO_SYNC_QUEUE } from './odoo-sync.constants';
import { ORDER_TASKS_QUEUE } from '@src/order/order-tasks.constants';
import { OdooSyncService } from './odoo-sync.service';
import { OdooSyncProcessor } from './odoo-sync.processor';
import { FleetReconcileService } from './fleet-reconcile.service';
import { DriverRequestReconcileService } from './driver-request-reconcile.service';
import { DriverStateReconcileService } from './driver-state-reconcile.service';
import { OrderStateReconcileService } from './order-state-reconcile.service';
import { OdooHealthMonitorService } from './odoo-health-monitor.service';
import { DeadLetterJob } from './entities/dead-letter-job.entity';
import { CatalogPushReconcileService } from './catalog-push-reconcile.service';
import { ShiftChangeStateReconcileService } from './shift-change-state-reconcile.service';
import { OrphanReconcileService } from './orphan-reconcile.service';
import { PushReconcileService } from './push-reconcile.service';
import { ProvinceReconcileService } from './province-reconcile.service';
import { WarehouseReconcileService } from './warehouse-reconcile.service';
import { OfferMirrorReconcileService } from './offer-mirror-reconcile.service';
import { DeliveryTariffReconcileService } from './delivery-tariff-reconcile.service';
import { OdooWebhookController } from './odoo-webhook.controller';

@Module({
  imports: [
    OdooModule,
    NotificationModule,
    PlatformSettingsModule,
    WasteCommonModule,
    // The product-suggestion webhook files an Odoo proposal through the same
    // service the app's own suggestion endpoint uses.
    SuggestionsModule,
    BullModule.registerQueue({ name: ODOO_SYNC_QUEUE }),
    // The order module consumes this one; we only enqueue onto it (start a
    // consolidation once its last warehouse has prepared) — no dependency on
    // the order module, just a shared queue name.
    BullModule.registerQueue({ name: ORDER_TASKS_QUEUE }),
    TypeOrmModule.forFeature([
      WasteCategory,
      Product,
      ProductPricing,
      // Read-only here: the live-offer mirror pushed onto Odoo's price sheet,
      // so an administrator sees the discount beside the list price.
      Offer,
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
      // Round ledger — read to tell a split rejection (all parts, one verdict)
      // from a single warehouse's, which re-allocate differently.
      OrderPartOffer,
      DistanceCache,
      // Re-pricing a reassigned leg reads the backend-admin delivery rate.
      DeliveryRate,
      // Durable landing spot for permanently-failed sync jobs (the DLQ).
      DeadLetterJob,
    ]),
  ],
  controllers: [OdooWebhookController],
  providers: [
    OdooSyncService,
    OdooSyncProcessor,
    // Provided directly (its only dependency, the delivery-rate repo, is in
    // forFeature above) rather than pulled in via WarehouseModule — which
    // imports THIS module, so importing it back would be a cycle. Stateless, so
    // a second instance costs nothing. Reassignment re-prices a leg at the SAME
    // backend-admin rate the rest of delivery uses.
    DeliveryRateService,
    FleetReconcileService,
    DriverRequestReconcileService,
    DriverStateReconcileService,
    OrderStateReconcileService,
    CatalogPushReconcileService,
    ShiftChangeStateReconcileService,
    OrphanReconcileService,
    PushReconcileService,
    ProvinceReconcileService,
    WarehouseReconcileService,
    OfferMirrorReconcileService,
    DeliveryTariffReconcileService,
    // Watches the backend↔Odoo link and alerts (ERROR log) on down/recovery.
    OdooHealthMonitorService,
  ],
  exports: [OdooSyncService],
})
export class OdooSyncModule {}
