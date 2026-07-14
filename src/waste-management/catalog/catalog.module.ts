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
import { CatalogService } from './catalog.service';

/**
 * Buyer-facing read side: each concern (categories, products, search, offers)
 * has its own route in CatalogController; PublicCatalogController exposes the
 * guest-accessible subset. Category restriction per role comes from
 * AssignedCategoryProvider (WasteCommonModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WasteCategory, Product, ProductPricing, Offer, Warehouse, WarehouseInventory]),
    PermissionsModule,
    WasteCommonModule,
  ],
  controllers: [CatalogController, PublicCatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
