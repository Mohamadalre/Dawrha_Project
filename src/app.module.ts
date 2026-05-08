import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { PermissionsModule } from './permission/permissions.module';
import { NotificationModule } from './notification/notification.module';
import {EventEmitterModule} from '@nestjs/event-emitter'
import { OnboardingModule } from './onboarding/onboarding.module';
import { MediaModule } from './media/media.module';
import { WasteManagementModule } from './waste-management/waste-management.module';
import { InstitutionModule } from './institution/institution.module';
import { CloudinaryModule } from './core/cloudinary/cloudinary.module';


@Module({
  imports: [
    EventEmitterModule.forRoot(), 
    CoreModule,
    UserModule,
    AuthModule,
    PermissionsModule,
    NotificationModule,
    OnboardingModule,
    MediaModule,
    WasteManagementModule,
    InstitutionModule,
    CloudinaryModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
