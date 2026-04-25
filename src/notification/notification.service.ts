import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import * as admin from 'firebase-admin';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationService {
    constructor(
        @Inject('FIREBASE_NOTIFICATION')
        private readonly firebaseApp: admin.app.App,
        @InjectRepository(UserDevice)
        private readonly userDerviceRep: Repository<UserDevice>,
        @InjectRepository(Notification)
        private readonly notificationrep: Repository<Notification>
    ) { }

    async sendToUser(
        userId: string,
        title: string,
        body: string,
        data?: Record<string, string>
    ) {
        const devices = await this.userDerviceRep.find({ where: { accountId: userId } });
        const tokens = devices
            .map(d => d.fcmToken)
            .filter(Boolean)
        if (!tokens.length) return;
        const message: admin.messaging.MulticastMessage = {
            tokens,
            notification: { title, body },
            data: data || {}
        };
        const response = await this.firebaseApp.messaging().sendEachForMulticast(message);
        return {
            successCount: response.successCount,
            failureCount: response.failureCount
        };
    }

    async sendToDevice(
        token: string,
        title: string,
        body: string,
        data?: Record<string, string>,
    ) {
        const message: admin.messaging.Message = {
            token,
            notification: {
                title,
                body,
            },
            data: data || {},
        };

        try {
            const response = await this.firebaseApp.messaging().send(message);
            return { success: true, messageId: response };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    getUserNotifications(userId: string) {
    return this.notificationrep.find({
      where: { user:{id:userId} },
      order: { createdAt: "DESC" },
    });
  }
}
