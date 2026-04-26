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
        data?: Record<string, string>,
    ) {
        const devices = await this.userDerviceRep.find({
            where: { accountId: userId },
        });

        const tokens = devices.map(d => d.fcmToken).filter(Boolean);

        if (!tokens.length) return;

        return this.firebaseApp.messaging().sendEachForMulticast({
            tokens,
            notification: { title, body },
            data: data || {},
        });
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

    create(data: Partial<Notification>) {
        return this.notificationrep.save(this.notificationrep.create(data));
    }

    findUserNotifications(userId: string) {
        return this.notificationrep.find({
            where: { user: { id: userId } },
            order: { createdAt: 'DESC' },
        });
    }

    async markAsRead(id: string) {
        await this.notificationrep.update(id, { isRead: true });
        return { message: 'Marked as read' };
    }
}
