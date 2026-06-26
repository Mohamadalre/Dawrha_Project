import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { NotificationModule } from '@src/notification/notification.module';
import { Account } from '@src/user/entities/account.entity';
import { InstitutionMaterial } from '@src/user/entities/material/institution-material.entity';
import { FactoryMaterial } from '@src/user/entities/material/factory-material.entity';
import { ExternalPartnerMaterial } from '@src/user/entities/material/external-partner-material.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { InstitutionWasteCategory } from '@src/waste-management/entities/institution-waste-category.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';
import { WasteCommonModule } from '@src/waste-management/common/waste-common.module';
import { CategoryRequest } from './entities/category-request.entity';
import { CategoryRequestService } from './category-request.service';
import { AssignedCategoryWriter } from './providers/assigned-category.writer';
import {
  AdminCategoryRequestController,
  CategoryRequestController,
} from './category-request.controller';

/**
 * Lets commercial roles request extra categories; admins approve/reject. On
 * approval the categories are linked to the account's material so visibility
 * (categories / products / offers) updates automatically.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CategoryRequest,
      WasteCategory,
      Account,
      InstitutionMaterial,
      FactoryMaterial,
      ExternalPartnerMaterial,
      InstitutionWasteCategory,
      FactoryWasteCategory,
      ExternalPartnerWasteCategory,
    ]),
    PermissionsModule,
    NotificationModule,
    WasteCommonModule,
  ],
  controllers: [CategoryRequestController, AdminCategoryRequestController],
  providers: [CategoryRequestService, AssignedCategoryWriter],
})
export class CategoryRequestModule {}
