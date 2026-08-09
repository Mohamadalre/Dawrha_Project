import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Media } from '@src/media/entities/media.entity';
import { Account } from '@src/user/entities/account.entity';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { UserModule } from '@src/user/user.module';
import { AuthModule } from '@src/auth/auth.module';
import { NotificationModule } from '@src/notification/notification.module';
import { PermissionsModule } from '@src/permission/permissions.module';
import { PointsWalletModule } from '@src/points-wallet/points-wallet.module';
import { OdooModule } from '@src/odoo/odoo.module';
import { AccountManagementController } from './account-management.controller';
import { SelfAccountController } from './self-account.controller';
import { OdooAdminAccountController } from './odoo-admin-account.controller';
import { AccountManagementService } from './account-management.service';
import { ProfileDataProvider } from './providers/profile-data.provider';
import { ApplicationsCacheService } from './providers/applications-cache.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Media, Account, UserDevice]),
    UserModule,
    AuthModule,
    NotificationModule,
    PermissionsModule,
    PointsWalletModule,
    // The Odoo admin-account controller edits res.users through OdooService.
    OdooModule,
  ],
  controllers: [AccountManagementController, SelfAccountController, OdooAdminAccountController],
  providers: [AccountManagementService, ProfileDataProvider, ApplicationsCacheService],
  // Exported so the onboarding module can drop the cached listings when an
  // APPLICANT corrects their own submission (not just when an admin acts).
  exports: [ApplicationsCacheService],
})
export class AccountManagementModule {}
