import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { NotificationModule } from '@src/notification/notification.module';
import { Account } from '@src/user/entities/account.entity';
import { ProductSuggestion } from '../entities/product-suggestion.entity';
import { WasteCommonModule } from '../common/waste-common.module';
import { SuggestionsController } from './suggestions.controller';
import { SuggestionsService } from './suggestions.service';

/**
 * Product suggestions submitted by buyers; admins are notified on creation.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProductSuggestion, Account]),
    PermissionsModule,
    NotificationModule,
    WasteCommonModule,
  ],
  controllers: [SuggestionsController],
  providers: [SuggestionsService],
})
export class SuggestionsModule {}
