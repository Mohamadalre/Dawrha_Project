import { forwardRef, Module } from '@nestjs/common';
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



@Module({
  imports:[
    TypeOrmModule.forFeature([AccountProgress,Account,Province,InstitutionProfile]),
    forwardRef(()=>AuthModule),
    UserModule,
    MediaModule
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports:[OnboardingService]
})
export class OnboardingModule {} 
