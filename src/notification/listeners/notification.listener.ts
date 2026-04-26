import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { SendNotificationEvent } from '../events/send-notification.event';

@Injectable()
export class NotificationListener {
  constructor(
    private readonly notificationService: NotificationService,
  ) {}

  @OnEvent('notification.send') 
  async handle(event:SendNotificationEvent) {
    const { userId, title, body, data } = event;
    await this.notificationService.create({
      user: { id: userId } as any,
      title,
      body,
      data,
    });

    // 2. Send FCM
    await this.notificationService.sendToUser(
      userId,
      title,
      body,
      data,
    );
  }
}