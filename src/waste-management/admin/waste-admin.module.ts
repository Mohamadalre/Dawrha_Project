import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { ProductPricingHistory } from '../entities/product-pricing-history.entity';
import { CartItem } from '../entities/cart-item.entity';
import { WasteCommonModule } from '../common/waste-common.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { PricingController } from './pricing/pricing.controller';
import { PricingService } from './pricing/pricing.service';

/**
 * Admin write-side: category/product CRUD (with Odoo sync jobs) and tiered
 * pricing. Separated from the buyer-facing read module by responsibility and
 * permission surface.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WasteCategory, Product, ProductPricing, ProductPricingHistory, CartItem]),
    PermissionsModule,
    OdooSyncModule,
    WasteCommonModule,
  ],
  controllers: [AdminCatalogController, PricingController],
  providers: [AdminCatalogService, PricingService],
})
export class WasteAdminModule {}
