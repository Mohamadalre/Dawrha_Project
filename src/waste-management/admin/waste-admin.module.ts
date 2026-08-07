import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { ProductPricingHistory } from '../entities/product-pricing-history.entity';
import { CartItem } from '../entities/cart-item.entity';
import { MeasurementUnit } from '../entities/measurement-unit.entity';
import { MaterialCondition } from '../entities/material-condition.entity';
import { Offer } from '../entities/offer.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { WasteCommonModule } from '../common/waste-common.module';
import { CloudinaryModule } from '@src/core/cloudinary/cloudinary.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { PricingController } from './pricing/pricing.controller';
import { PricingService } from './pricing/pricing.service';
import { ProductConditionsService } from './product-conditions.service';
import { ProductConditionsController } from './product-conditions.controller';
import { ConditionByIdController } from './condition-by-id.controller';
import { StockTransferService } from './stock-transfer.service';
import { StockTransferController } from './stock-transfer.controller';

/**
 * Admin write-side: category/product CRUD (with Odoo sync jobs) and tiered
 * pricing. Separated from the buyer-facing read module by responsibility and
 * permission surface.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WasteCategory, Product, ProductPricing, ProductPricingHistory, CartItem, MeasurementUnit, MaterialCondition, Offer,
      // Deleting a material has to know whether any is still on a shelf.
      WarehouseInventory]),
    PermissionsModule,
    OdooSyncModule,
    WasteCommonModule,
    CloudinaryModule,
  ],
  controllers: [
    AdminCatalogController,
    PricingController,
    ProductConditionsController,
    // A grade belongs to exactly one material, so its id identifies it
    // completely — this is the canonical way to edit, reorder or delete one.
    ConditionByIdController,
  ],
  providers: [
    AdminCatalogService,
    PricingService,
    ProductConditionsService,
    StockTransferService,
  ],
  exports: [ProductConditionsService],
})
export class WasteAdminModule {}
