import { forwardRef, Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountProgress } from './entities/account-progress.entity';
import { Account } from '@src/user/entities/account.entity';
import { AuthModule } from '@src/auth/auth.module';

@Module({
  imports:[
    TypeOrmModule.forFeature([AccountProgress,Account]),
    forwardRef(()=>AuthModule)
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports:[OnboardingService]
})
export class OnboardingModule {} 
