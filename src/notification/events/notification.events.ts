import { NotificationMetadata } from '../interfaces/notification-payload.interface';
import { NotificationType } from '../enums/notification-type.enum';

export class SendNotificationEvent {
  constructor(
    public readonly userId: string,
    public readonly title: string,
    public readonly body: string,
    public readonly type?: NotificationType,
    public readonly metadata?: NotificationMetadata,
  ) {}
}
