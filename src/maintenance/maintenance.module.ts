import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '@src/notification/entities/notification.entity';
import { Account } from '@src/user/entities/account.entity';
import { Cart } from '@src/waste-management/entities/cart.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { ProductSuggestion } from '@src/waste-management/entities/product-suggestion.entity';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, Account, Cart, CartItem, ProductSuggestion]),
  ],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
