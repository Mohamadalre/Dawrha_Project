import { NotificationType } from '../enums/notification-type.enum';

/** i18n keys + args so a push can be localized per device at send time. */
export interface NotificationI18n {
  titleKey?: string;
  bodyKey?: string;
  args?: Record<string, unknown>;
}

export interface NotificationMetadata {
  deepLink?: string;
  category?: string;
  /** Set when the notification should be translated per recipient device. */
  i18n?: NotificationI18n;
  [key: string]: unknown;
}

export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  type?: NotificationType;
  metadata?: NotificationMetadata;
  /**
   * Optional i18n keys. When provided, `title`/`body` are stored as the default
   * (English) text and each device receives the push in its own language.
   */
  titleKey?: string;
  bodyKey?: string;
  args?: Record<string, unknown>;
}

export interface NotificationJobPayload {
  notificationId: string;
}
