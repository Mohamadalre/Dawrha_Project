import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '@src/permission/permissions.module';
import { NotificationModule } from '@src/notification/notification.module';
import { Account } from '@src/user/entities/account.entity';
import { ProductSuggestion } from '../entities/product-suggestion.entity';
import { WasteCategory } from '../entities/waste-category.entity';
import { WasteCommonModule } from '../common/waste-common.module';
import { SuggestionsController } from './suggestions.controller';
import { AdminSuggestionsController } from './admin-suggestions.controller';
import { SuggestionsService } from './suggestions.service';

/**
 * Product suggestions submitted by buyers; admins are notified on creation.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProductSuggestion, Account, WasteCategory]),
    PermissionsModule,
    NotificationModule,
    WasteCommonModule,
  ],
  controllers: [SuggestionsController, AdminSuggestionsController],
  providers: [SuggestionsService],
  // The Odoo webhook files proposals through the same service the app uses.
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
