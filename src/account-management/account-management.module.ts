import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Media } from '@src/media/entities/media.entity';
import { Account } from '@src/user/entities/account.entity';
import { UserModule } from '@src/user/user.module';
import { AuthModule } from '@src/auth/auth.module';
import { AccountManagementController } from './account-management.controller';
import { AccountManagementService } from './account-management.service';
import { ProfileDataProvider } from './providers/profile-data.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([Media, Account]),
    UserModule,
    AuthModule,
  ],
  controllers: [AccountManagementController],
  providers: [AccountManagementService, ProfileDataProvider],
})
export class AccountManagementModule {}
