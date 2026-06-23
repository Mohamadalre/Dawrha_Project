import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '@src/core/cloudinary/cloudinary.module';
import { WasteManagementService } from './waste-management.service';
import { WasteManagementController } from './waste-management.controller';
import { WasteCategory } from './entities/waste-category.entity';
import { InstitutionWasteCategory } from './entities/institution-waste-category.entity';
import { FactoryWasteCategory } from './entities/factory-waste-category.entity';
import { ExternalPartnerWasteCategory } from './entities/external-partner-waste-category.entity';

/**
 * Legacy waste-category endpoints (admin create with image upload + role-based
 * listing). The marketplace read/cart/admin features live in their own modules:
 * CatalogModule, CartModule, SuggestionsModule, WasteAdminModule — all sharing
 * WasteCommonModule (`common/`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WasteCategory,
      InstitutionWasteCategory,
      FactoryWasteCategory,
      ExternalPartnerWasteCategory,
    ]),
    CloudinaryModule,
  ],
  controllers: [WasteManagementController],
  providers: [WasteManagementService],
})
export class WasteManagementModule {}
