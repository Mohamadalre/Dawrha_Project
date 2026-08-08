import { Module } from '@nestjs/common';
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
import { PendingProfileHandler } from './handlers/pending-profile.handler';
import { PendingApprovalHandler } from './handlers/pending-approval.handler';
import { BlockedHandler } from './handlers/blocked.handler';
import { RejectedHandler } from './handlers/rejected.handler';
import { InactiveHandler } from './handlers/inactive.handler';
import { NeedChangeHandler } from './handlers/needChange.handler';
//import { JwtOnboardingStrategy } from './strategies/jwt-onboarding.strategy';
import { CommonModule } from '@src/common/common.module';
import { PointsWalletModule } from '@src/points-wallet/points-wallet.module';
import { AccountStatusGuard } from './guards/account-status.guard';
@Module({
  imports: [
    TypeOrmModule.forFeature([UserDevice, Account]),
    UserModule,
    PassportModule,
    CommonModule,
    PointsWalletModule,
    JwtModule.register({}),
    BullModule.registerQueue({
      name: 'mail-queue'
    }),

  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, MailService, JwtTemporaryStrategy,
     ActiveHandler, PendingProfileHandler, PendingApprovalHandler, BlockedHandler, 
     RejectedHandler, NeedChangeHandler, InactiveHandler,AccountStatusGuard],
  exports: [AuthService, MailService,AccountStatusGuard],
})
export class AuthModule { }
