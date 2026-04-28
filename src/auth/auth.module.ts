import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserDevice } from './entities/user-device.entity';
import { UserModule } from '../user/user.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailService } from '../core/mail/mail.service';
import { Account } from '@src/user/entities/account.entity';
import { BullModule } from '@nestjs/bullmq';
import { JwtTemporaryStrategy } from './strategies/jwt-temporary.strategy';
import { ActiveHandler } from './handlers/active.handler';
import { OnboardingModule } from '@src/onboarding/onboarding.module';
import { PendingProfileHandler } from './handlers/pending-profile.handler';
import { PendingApprovalHandler } from './handlers/pending-approval.handler';
import { BlockedHandler } from './handlers/blocked.handler';
import { RejectedHandler } from './handlers/rejected.handler';
import { InactiveHandler } from './handlers/inactive.handler';
import { NeedChangeHandler } from './handlers/needChange.handler';
import { JwtOnboardingStrategy } from './strategies/jwt-onboarding.strategy';
@Module({
  imports: [
    TypeOrmModule.forFeature([UserDevice, Account]),
    UserModule,
    PassportModule,
    forwardRef(()=>OnboardingModule),
    JwtModule.register({}),
    BullModule.registerQueue({
      name: 'mail-queue'
    }),
    
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, MailService,JwtTemporaryStrategy,ActiveHandler,PendingProfileHandler,PendingApprovalHandler,BlockedHandler,RejectedHandler,NeedChangeHandler,InactiveHandler,JwtOnboardingStrategy],
  exports: [AuthService, MailService,JwtOnboardingStrategy],
})
export class AuthModule { }
