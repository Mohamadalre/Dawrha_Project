import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Media } from './entities/media.entity';
import { Account } from '@src/user/entities/account.entity';
import { CommonModule } from '@src/common/common.module';
import { OdooSyncModule } from '@src/odoo-sync/odoo-sync.module';
import { CoreModule } from '@src/core/core.module';
import { UserModule } from '@src/user/user.module';
import { AccountManagementModule } from '@src/account-management/account-management.module';
import { PermissionsModule } from '@src/permission/permissions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Media, Account]),
    CommonModule,
    CoreModule,
    UserModule,
    OdooSyncModule,
    // Provides PermissionsGuard (+ its deps) for the admin-only owner route.
    PermissionsModule,
    // For the applications cache only: an applicant replacing a requested
    // document moves their own account back into the reviewer's queue.
    AccountManagementModule,
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
