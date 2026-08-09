import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { WasteCommonModule } from '@src/waste-management/common/waste-common.module';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { InstitutionMaterial } from '@src/user/entities/material/institution-material.entity';
import { FactoryMaterial } from '@src/user/entities/material/factory-material.entity';
import { ExternalPartnerMaterial } from '@src/user/entities/material/external-partner-material.entity';
import { InstitutionWasteCategory } from '@src/waste-management/entities/institution-waste-category.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';
import { MyCategoriesController } from './my-categories.controller';
import { MyCategoriesService } from './my-categories.service';
import { AssignedCategoryWriter } from './assigned-category.writer';

/**
 * A buyer's own selected-categories list — view it, and add to it directly.
 * Replaces the old admin-approved category-request flow, which only existed
 * while buyers were restricted to their picked categories (they no longer are).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WasteCategory,
      InstitutionMaterial,
      FactoryMaterial,
      ExternalPartnerMaterial,
      InstitutionWasteCategory,
      FactoryWasteCategory,
      ExternalPartnerWasteCategory,
    ]),
    PermissionsModule,
    // AssignedCategoryProvider (reads the current selections) lives here.
    WasteCommonModule,
  ],
  controllers: [MyCategoriesController],
  providers: [MyCategoriesService, AssignedCategoryWriter],
})
export class MyCategoriesModule {}
