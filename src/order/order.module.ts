import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WarehouseModule } from '@src/warehouse/warehouse.module';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
import { OdooModule } from '@src/odoo/odoo.module';
import { PlatformSettingsModule } from '@src/platform-settings/platform-settings.module';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { Order } from './entities/order.entity';
import { OrderPart } from './entities/order-part.entity';
import { OrderPartLine } from './entities/order-part-line.entity';
import { OrderPartOffer } from './entities/order-part-offer.entity';
import { OrderMinimum } from './entities/order-minimum.entity';
import { OrderSpendingCap } from './entities/order-spending-cap.entity';
import { DistanceCache } from './entities/distance-cache.entity';
import { OrderPartRating } from './entities/order-part-rating.entity';
import { OrderComplaint } from './entities/order-complaint.entity';
import { DeliveryTrip } from './entities/delivery-trip.entity';
import { DeliveryTripStop } from './entities/delivery-trip-stop.entity';
import { DeliveryTripService } from './providers/delivery-trip.service';
import { DeliveryDispatchService } from './providers/delivery-dispatch.service';
// DeliveryTripController removed — delivery is fully automatic + Odoo-executed.
import { DeliveryWebhookController } from './delivery-webhook.controller';
import { AdminComplaintService } from './providers/admin-complaint.service';
import { AdminComplaintController } from './admin-complaint.controller';
import { Cart } from '@src/waste-management/entities/cart.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { Account } from '@src/user/entities/account.entity';
import { FactoryProfile } from '@src/user/entities/profile/factory-profile.entity';
import { ExternalPartnerProfile } from '@src/user/entities/profile/external-partner-profile.entity';
import { OrderStateService } from './providers/order-state.service';
import { OrderMinimumService } from './providers/order-minimum.service';
import { OrderSpendingCapService } from './providers/order-spending-cap.service';
import { DistanceService } from './providers/distance.service';
import { OrderAllocationService } from './providers/order-allocation.service';
import { OfferExpiryService } from './providers/offer-expiry.service';
import { DistanceRefreshService } from './providers/distance-refresh.service';
import { OrderCheckoutService } from './providers/order-checkout.service';
import { OrderViewService } from './providers/order-view.service';
import { OrderController } from './order.controller';
import { AdminOrderController } from './admin-order.controller';
import { OdooOrderModifyController } from './odoo-order-modify.controller';
import { OrderConstraintsController } from './order-constraints.controller';
import { OrderTasksProcessor } from './order-tasks.processor';
import { ORDER_TASKS_QUEUE } from './order-tasks.constants';
import { PermissionsModule } from '@src/permission/permissions.module';
import { WasteCommonModule } from '@src/waste-management/common/waste-common.module';
import { PointsWalletModule } from '@src/points-wallet/points-wallet.module';

/**
 * Ordering for factories and free facilities.
 *
 * The two roles behave identically except for delivery, so there is one flow
 * with one branch rather than two parallel implementations. Citizens and
 * institutions will place orders through these same tables later — `buyerRole`
 * is already carried on every order for exactly that reason.
 */
@Module({
  imports: [
    ConfigModule,
    // Only the distance provider is called over HTTP, and never from the order
    // path — a warm-up job fills the cache ahead of time.
    HttpModule,
    TypeOrmModule.forFeature([
      Order,
      OrderPart,
      OrderPartLine,
      OrderPartOffer,
      OrderMinimum,
      OrderSpendingCap,
      DistanceCache,
      Warehouse,
      WarehouseInventory,
      OrderPartRating,
      OrderComplaint,
      // Routing a split order to the buyer: one truck run per vehicle, and
      // one stop per warehouse it calls at.
      DeliveryTrip,
      DeliveryTripStop,
      Cart,
      CartItem,
      Product,
      Account,
      FactoryProfile,
      ExternalPartnerProfile,
    ]),
    // A consolidation is started off an Odoo part event, but planned by this
    // module's own service — so the Odoo-sync module enqueues onto this queue
    // and this module's processor consumes it, with no dependency between them.
    BullModule.registerQueue({ name: ORDER_TASKS_QUEUE }),
    // Delivery is priced from the mirror of the tariffs Odoo's admin authors.
    WarehouseModule,
    // Parts are pushed to Odoo through the queue, never called inline.
    OdooSyncModule,
    // Reading a delivery truck's driver during dispatch is a live RPC lookup.
    OdooModule,
    // The ONE central currency the min/max constraints stamp on new rows.
    PlatformSettingsModule,
    PermissionsModule,
    // Supplies SellabilityService: a line may not be ordered without a live
    // price for the buyer's tier.
    WasteCommonModule,
    // Confirming receipt rewards the buyer with points at the admin's per-role
    // rate.
    PointsWalletModule,
  ],
  providers: [
    OrderStateService,
    OrderMinimumService,
    OrderSpendingCapService,
    DistanceService,
    OrderAllocationService,
    OfferExpiryService,
    DistanceRefreshService,
    OrderCheckoutService,
    OrderViewService,
    DeliveryTripService,
    DeliveryDispatchService,
    AdminComplaintService,
    OrderTasksProcessor,
  ],
  controllers: [
    OrderController,
    AdminOrderController,
    OrderConstraintsController,
    // DeliveryTripController REMOVED: delivery is run entirely by the SYSTEM —
    // planning + truck-scoring + assignment fire automatically when an order is
    // ready (see maybeTriggerDelivery → PLAN_DELIVERY), and the driver executes
    // the trip IN ODOO (pickups + handover), reported back by the webhook below.
    // The backend admin neither triggers, views, nor tracks delivery trips.
    DeliveryWebhookController,
    OdooOrderModifyController,
    AdminComplaintController,
  ],
  exports: [
    OrderStateService,
    OrderMinimumService,
    OrderSpendingCapService,
    DistanceService,
    OrderAllocationService,
  ],
})
export class OrderModule {}
