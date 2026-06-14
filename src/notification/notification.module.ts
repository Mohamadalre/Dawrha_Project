import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationController } from './notification.controller';
import { NotificationListener } from './listeners/notification.listener';
import { NotificationProcessor } from './processors/notification.processor';
import { NotificationService } from './notification.service';
import { FirebaseService } from './services/firebase.service';
import { Notification } from './entities/notification.entity';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { Account } from '@src/user/entities/account.entity';
import { NOTIFICATION_QUEUE_NAME } from './queues/notification.queue';
import * as admin from 'firebase-admin';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, UserDevice, Account]),
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE_NAME,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    FirebaseService,
    NotificationListener,
    NotificationProcessor,
    {
      provide: 'FIREBASE_ADMIN_APP',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        if (admin.apps.length) {
          return admin.app();
        }

        return admin.initializeApp({
          credential: admin.credential.cert({
            projectId: configService.get<string>('FIREBASE_PROJECT_ID'),
            clientEmail: configService.get<string>('FIREBASE_CLIENT_EMAIL'),
            privateKey: configService
              .get<string>('FIREBASE_PRIVATE_KEY')
              ?.replace(/\\n/g, '\n'),
          }),
        });
      },
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
