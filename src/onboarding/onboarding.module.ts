import {  Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountProgress } from './entities/account-progress.entity';
import { Account } from '@src/user/entities/account.entity';
import { AuthModule } from '@src/auth/auth.module';
import { Province } from '@src/user/entities/location/province.entity';
import { UserModule } from '@src/user/user.module';
import { InstitutionProfile } from '@src/user/entities/profile/institution-profile.entity';
import { MediaModule } from '@src/media/media.module';
import { CommonModule } from '@src/common/common.module';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { InstitutionType } from '@src/institution/entities/institution-type.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { FactoryProfile } from '@src/user/entities/profile/factory-profile.entity';
import { FactoryMaterial } from '@src/user/entities/material/factory-material.entity';
import { ExternalPartnerMaterial } from '@src/user/entities/material/external-partner-material.entity';
import { ExternalPartnerProfile } from '@src/user/entities/profile/external-partner-profile.entity';
import { CloudinaryModule } from '@src/core/cloudinary/cloudinary.module';
import { InstitutionMaterial } from '@src/user/entities/material/institution-material.entity';



@Module({
  imports: [
    TypeOrmModule.forFeature([AccountProgress, Account,
       Province, InstitutionProfile,CollectorProfile,
       WasteCategory,InstitutionType,FactoryProfile,
       FactoryWasteCategory,
       ExternalPartnerProfile,
       ExternalPartnerWasteCategory,
       InstitutionMaterial,
       FactoryMaterial,
       ExternalPartnerMaterial

      ]),
    AuthModule,
    UserModule,
    MediaModule,
    CommonModule,
    CloudinaryModule
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService]
})
export class OnboardingModule { } 
