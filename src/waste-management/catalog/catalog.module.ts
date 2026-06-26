import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { WasteCommonModule } from '../common/waste-common.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

/**
 * Buyer-facing read side: categories, products, search, offers and the home
 * aggregator. Category restriction per role comes from AssignedCategoryProvider
 * (WasteCommonModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WasteCategory, Product, ProductPricing, Offer]),
    PermissionsModule,
    WasteCommonModule,
  ],
  controllers: [CatalogController, HomeController],
  providers: [CatalogService, HomeService],
})
export class CatalogModule {}
