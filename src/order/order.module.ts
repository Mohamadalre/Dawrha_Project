import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WarehouseModule } from '@src/warehouse/warehouse.module';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
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
import { DeliveryTripController } from './delivery-trip.controller';
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
import { OrderConstraintsController } from './order-constraints.controller';
import { PermissionsModule } from '@src/permission/permissions.module';
import { WasteCommonModule } from '@src/waste-management/common/waste-common.module';

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
    // Delivery is priced from the mirror of the tariffs Odoo's admin authors.
    WarehouseModule,
    // Parts are pushed to Odoo through the queue, never called inline.
    OdooSyncModule,
    PermissionsModule,
    // Supplies SellabilityService: a line may not be ordered without a live
    // price for the buyer's tier.
    WasteCommonModule,
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
  ],
  controllers: [OrderController, OrderConstraintsController, DeliveryTripController],
  exports: [
    OrderStateService,
    OrderMinimumService,
    OrderSpendingCapService,
    DistanceService,
    OrderAllocationService,
  ],
})
export class OrderModule {}
