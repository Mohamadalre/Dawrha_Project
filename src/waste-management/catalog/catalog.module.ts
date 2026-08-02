import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { WasteCommonModule } from '../common/waste-common.module';
import { CatalogController } from './catalog.controller';
import { PublicCatalogController } from './public-catalog.controller';
import {
  FactoryAppGuestController,
  UserAppGuestController,
} from './guest-app.controller';
import { CatalogService } from './catalog.service';
import { PopularityService } from './popularity.service';
import { OrderPartLine } from '@src/order/entities/order-part-line.entity';
import { GuestAppService } from './guest-app.service';

/**
 * Buyer-facing read side: each concern (categories, products, search, offers)
 * has its own route in CatalogController; PublicCatalogController exposes the
 * guest-accessible subset. Category restriction per role comes from
 * AssignedCategoryProvider (WasteCommonModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WasteCategory,
      Product,
      ProductPricing,
      Offer,
      Warehouse,
      WarehouseInventory,
      // Read-only: the popularity list is built from what has actually been
      // ordered. Only the ENTITY is borrowed, not the ordering module — so
      // there is no dependency cycle between reading orders and placing them.
      OrderPartLine,
    ]),
    PermissionsModule,
    WasteCommonModule,
  ],
  controllers: [
    CatalogController,
    PublicCatalogController,
    // Per-app visitor catalogues. Separate controllers rather than one route
    // with an `app` parameter: the audience decides which price sheet is
    // revealed, so it must be fixed by the path and unreachable from the query.
    UserAppGuestController,
    FactoryAppGuestController,
  ],
  providers: [CatalogService, GuestAppService, PopularityService],
})
export class CatalogModule {}
