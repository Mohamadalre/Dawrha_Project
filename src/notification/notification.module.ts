import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import * as admin from 'firebase-admin';


import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { Account } from '@src/user/entities/account.entity';
import { Notification } from './entities/notification.entity';

@Module({
  imports:[TypeOrmModule.forFeature([UserDevice,Account,Notification]),],
  controllers: [NotificationController],
 providers: [
  NotificationService,
    {
      provide: 'FIREBASE_NOTIFICATION',
      useFactory: () => {
        const app = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          }),
        });

        return app;
      },
    },
  ],
  exports: ['FIREBASE_NOTIFICATION'],
})
export class NotificationModule {}
