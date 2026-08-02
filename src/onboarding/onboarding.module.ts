import {  Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { InstitutionOnboardingService } from './services/institution-onboarding.service';
import { CollectorOnboardingService } from './services/collector-onboarding.service';
import { FactoryOnboardingService } from './services/factory-onboarding.service';
import { ExternalPartnerOnboardingService } from './services/external-partner-onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { InstitutionOnboardingController } from './controllers/institution-onboarding.controller';
import { FactoryOnboardingController } from './controllers/factory-onboarding.controller';
import { ExternalPartnerOnboardingController } from './controllers/external-partner-onboarding.controller';
import { CollectorOnboardingController } from './controllers/collector-onboarding.controller';
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
import { InstitutionMaterial } from '@src/user/entities/material/institution-material.entity';
import { CoreModule } from '@src/core/core.module';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
import { NotificationModule } from '@src/notification/notification.module';
import { ShiftModule } from '@src/shift/shift.module';
import { ProvinceAdminController } from './controllers/province-admin.controller';
import { ProvinceAdminService } from './services/province-admin.service';
import { ProvinceUsageService } from './services/province-usage.service';
import { OnboardingSubmissionService } from './services/onboarding-submission.service';
import { Media } from '@src/media/entities/media.entity';
import { AccountManagementModule } from '@src/account-management/account-management.module';



@Module({
  imports: [
    NotificationModule,
    OdooSyncModule,
    TypeOrmModule.forFeature([AccountProgress, Account,
       Province, InstitutionProfile,CollectorProfile,
       WasteCategory,InstitutionType,FactoryProfile,
       FactoryWasteCategory,
       ExternalPartnerProfile,
       ExternalPartnerWasteCategory,
       InstitutionMaterial,
       FactoryMaterial,
       ExternalPartnerMaterial,
       Media

      ]),
    AuthModule,
    UserModule,
    MediaModule,
    CommonModule,
    CoreModule,
    ShiftModule,
    // For ApplicationsCacheService: an applicant's correction must drop the
    // admin's cached listing pages.
    AccountManagementModule,
  ],
  controllers: [OnboardingController, InstitutionOnboardingController, FactoryOnboardingController, ExternalPartnerOnboardingController, CollectorOnboardingController, ProvinceAdminController],
  providers: [
    OnboardingService,
    InstitutionOnboardingService,
    CollectorOnboardingService,
    FactoryOnboardingService,
    ExternalPartnerOnboardingService,
    ProvinceAdminService,
    ProvinceUsageService,
    OnboardingSubmissionService
  ],
  exports: [
    OnboardingService,
    InstitutionOnboardingService,
    CollectorOnboardingService,
    FactoryOnboardingService,
    ExternalPartnerOnboardingService
  ]
})
export class OnboardingModule { } 
