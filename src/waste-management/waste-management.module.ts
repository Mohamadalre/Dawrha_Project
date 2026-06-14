import { Module } from '@nestjs/common';
import { WasteManagementService } from './waste-management.service';
import { WasteManagementController } from './waste-management.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WasteCategory } from './entities/waste-category.entity';
import { InstitutionWasteCategory } from './entities/institution-waste-category.entity';
import { FactoryWasteCategory } from './entities/factory-waste-category.entity';
import { ExternalPartnerWasteCategory } from './entities/external-partner-waste-category.entity';
import { CloudinaryModule } from '@src/core/cloudinary/cloudinary.module';

@Module({
  imports: [TypeOrmModule.forFeature([WasteCategory, InstitutionWasteCategory,
    FactoryWasteCategory, ExternalPartnerWasteCategory
  ]),
    CloudinaryModule
  ],
  controllers: [WasteManagementController],
  providers: [WasteManagementService],
})
export class WasteManagementModule { }
