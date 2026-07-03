import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import * as path from 'path';
import {
  I18nModule,
  HeaderResolver,
  QueryResolver,
  AcceptLanguageResolver,
} from 'nestjs-i18n';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { LoggerModule } from './core/logger-config/logger.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { PermissionsModule } from './permission/permissions.module';
import { NotificationModule } from './notification/notification.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OnboardingModule } from './onboarding/onboarding.module';
import { MediaModule } from './media/media.module';
import { WasteManagementModule } from './waste-management/waste-management.module';
import { CatalogModule } from './waste-management/catalog/catalog.module';
import { CartModule } from './waste-management/cart/cart.module';
import { SuggestionsModule } from './waste-management/suggestions/suggestions.module';
import { WasteAdminModule } from './waste-management/admin/waste-admin.module';
import { CategoryRequestModule } from './waste-management/category-requests/category-request.module';
import { InstitutionModule } from './institution/institution.module';
import { CloudinaryModule } from './core/cloudinary/cloudinary.module';
import { AccountManagementModule } from './account-management/account-management.module';
import { TruckModule } from './truck/truck.module';
import { OdooModule } from './odoo/odoo.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { OdooSyncModule } from './odoo-sync/odoo-sync.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { ReportsModule } from './reports/reports.module';
import { ShiftModule } from './shift/shift.module';



@Module({
  imports: [
    EventEmitterModule.forRoot(),
    // i18n: language chosen via `x-lang` / `lang` header (or Accept-Language).
    // Response messages are translated by the global interceptor / exception filter.
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(__dirname, '/i18n/'),
        watch: true,
      },
      resolvers: [
        new HeaderResolver(['x-lang', 'lang']),
        new QueryResolver(['lang']),
        AcceptLanguageResolver,
      ],
    }),
    // Global rate limiting. Counters are stored in Redis so the limit is shared
    // across all app instances. Default: 100 requests / 60s per IP; sensitive
    // endpoints (auth, suggestions) tighten this with @Throttle().
    ThrottlerModule.forRootAsync({
      inject: ['REDIS_CLIENT'],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    LoggerModule,
    CoreModule,
    UserModule,
    AuthModule,
    PermissionsModule,
    NotificationModule,
    OnboardingModule,
    MediaModule,
    WasteManagementModule,
    CatalogModule,
    CartModule,
    SuggestionsModule,
    WasteAdminModule,
    CategoryRequestModule,
    InstitutionModule,
    CloudinaryModule,
    AccountManagementModule,
    TruckModule,
    OdooModule,
    WarehouseModule,
    OdooSyncModule,
    MaintenanceModule,
    ReportsModule,
    ShiftModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply the throttler globally to every HTTP route.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule { }
