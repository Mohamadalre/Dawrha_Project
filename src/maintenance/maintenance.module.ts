import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '@src/notification/entities/notification.entity';
import { Account } from '@src/user/entities/account.entity';
import { Cart } from '@src/waste-management/entities/cart.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { NotificationModule } from '@src/notification/notification.module';
import { OdooModule } from '@src/odoo/odoo.module';
import { MaintenanceService } from './maintenance.service';
import { HandoverCronService } from './handover-cron.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      Account,
      Cart,
      CartItem,
      TruckHandover,
      TruckAssignmentEntity,
    ]),
    NotificationModule,
    OdooModule,
  ],
  providers: [MaintenanceService, HandoverCronService],
})
export class MaintenanceModule {}
