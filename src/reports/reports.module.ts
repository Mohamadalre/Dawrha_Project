import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { Account } from '@src/user/entities/account.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { Offer } from '@src/waste-management/entities/offer.entity';
import { ProductSuggestion } from '@src/waste-management/entities/product-suggestion.entity';
import { StatisticsService } from './statistics.service';
import { StatisticsController } from './statistics.controller';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
import { OdooModule } from '@src/odoo/odoo.module';

/**
 * Admin-only reports & statistics. Read-only aggregation across existing tables.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      TruckEntity,
      TruckAssignmentEntity,
      Warehouse,
      WasteCategory,
      Product,
      Offer,
      ProductSuggestion,
    ]),
    PermissionsModule,
    // Odoo is the fleet master; the truck stats queue a refresh from it.
    OdooSyncModule,
    // Delivery trucks live only in Odoo, so the delivery figure is read live.
    OdooModule,
  ],
  controllers: [StatisticsController],
  providers: [StatisticsService],
})
export class ReportsModule {}
