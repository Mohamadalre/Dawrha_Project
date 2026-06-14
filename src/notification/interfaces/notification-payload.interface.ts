import { NotificationType } from '../enums/notification-type.enum';

export interface NotificationMetadata {
  deepLink?: string;
  category?: string;
  [key: string]: unknown;
}

export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  type?: NotificationType;
  metadata?: NotificationMetadata;
}

export interface NotificationJobPayload {
  notificationId: string;
}
