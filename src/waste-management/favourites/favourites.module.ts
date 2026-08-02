import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { Favourite } from '../entities/favourite.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { WasteCommonModule } from '../common/waste-common.module';
import { FavouritesController } from './favourites.controller';
import { FavouritesService } from './favourites.service';

/**
 * A buyer's shortlist of materials — one module for all four buyer roles.
 *
 * Pricing comes in because the list shows the caller's OWN tier price: a
 * favourites screen with no numbers sends the buyer back to the catalogue to
 * look each one up, which is the trip the list exists to save.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Favourite, Product, ProductPricing]),
    PermissionsModule,
    WasteCommonModule,
  ],
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}
