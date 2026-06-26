import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { Cart } from '../entities/cart.entity';
import { CartItem } from '../entities/cart-item.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

/**
 * Cart bounded context: add/update/remove items & offers with per-role limits.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartItem, Product, ProductPricing, Offer]),
    PermissionsModule,
  ],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
