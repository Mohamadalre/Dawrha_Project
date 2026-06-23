import { Module } from '@nestjs/common';
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
import { InstitutionModule } from './institution/institution.module';
import { CloudinaryModule } from './core/cloudinary/cloudinary.module';
import { AccountManagementModule } from './account-management/account-management.module';
import { TruckModule } from './truck/truck.module';
import { OdooModule } from './odoo/odoo.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { OdooSyncModule } from './odoo-sync/odoo-sync.module';
import { MaintenanceModule } from './maintenance/maintenance.module';



@Module({
  imports: [
    EventEmitterModule.forRoot(), 
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
    InstitutionModule,
    CloudinaryModule,
    AccountManagementModule,
    TruckModule,
    OdooModule,
    WarehouseModule,
    OdooSyncModule,
    MaintenanceModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
