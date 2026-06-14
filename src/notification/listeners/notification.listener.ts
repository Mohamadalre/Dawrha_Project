import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import { SendNotificationEvent } from '../events/notification.events';

@Injectable()
export class NotificationListener {
  constructor(
    private readonly notificationService: NotificationService,
  ) {}

  @OnEvent('notification.send', { async: true })
  async handleNotificationSend(event: SendNotificationEvent) {
    const notification = await this.notificationService.createNotification({
      userId: event.userId,
      title: event.title,
      body: event.body,
      type: event.type,
      metadata: event.metadata,
    });

    await this.notificationService.enqueueNotification(notification.id);
  }
}