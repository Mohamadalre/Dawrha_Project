import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserDevice } from './entities/user-device.entity';
import { UserModule } from '../user/user.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OtpService } from '../core/mail/otp.service';
import { Account } from '@src/user/entities/account.entity';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserDevice, Account]),
    UserModule,
    PassportModule,
    JwtModule.register({}),
    BullModule.registerQueue({
          name:'mail-queue'
        }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, OtpService],
  exports: [AuthService, OtpService],
})
export class AuthModule { }
