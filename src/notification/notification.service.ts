import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, In } from 'typeorm';
import { Queue } from 'bullmq';
import { I18nService } from 'nestjs-i18n';
import { Notification } from './entities/notification.entity';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { Account } from '@src/user/entities/account.entity';
import { Language } from '@src/common/enums/language.enum';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationJobPayload } from './interfaces/notification-payload.interface';
import {
  NOTIFICATION_BACKOFF_DELAY_MS,
  NOTIFICATION_MAX_ATTEMPTS,
  PERMANENT_FAILURE_REASONS,
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_SEND_JOB_NAME,
} from './queues/notification.queue';
import { NotificationStatus } from './enums/notification-status.enum';
import { NotificationPayload } from './interfaces/notification-payload.interface';
import { NotificationNotFoundException } from './exceptions/notification.exceptions';
import { winstonLogger } from '@src/core/logger-config/winston.config';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger('NOTIFICATIONS');

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(UserDevice)
    private readonly userDeviceRepository: Repository<UserDevice>,
    @InjectQueue(NOTIFICATION_QUEUE_NAME)
    private readonly notificationQueue: Queue,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Renders a notification's title/body in the READER's language for display.
   *
   * The row stores the default (English) text plus, when the creator supplied
   * them, i18n keys + args under `metadata.i18n` — the same keys the push
   * processor already localises at send time. The in-app list used to show only
   * the stored English text; this translates it for the account viewing it, so a
   * signed-in Arabic user sees Arabic notifications without sending any header.
   * Falls back to the stored text when there is no key or the key is missing.
   */
  private localize(notification: Notification, lang?: string): Notification {
    const i18n = (notification.metadata as any)?.i18n as
      | { titleKey?: string; bodyKey?: string; args?: Record<string, unknown> }
      | undefined;
    if (!i18n || (!i18n.titleKey && !i18n.bodyKey) || !lang) return notification;

    const tr = (key?: string, fallback?: string): string => {
      if (!key) return fallback ?? '';
      const out = this.i18n.translate(`translation.${key}`, {
        lang,
        args: i18n.args,
      });
      // I18nService returns the key path back when it cannot resolve it.
      return typeof out === 'string' && out !== `translation.${key}` && out !== key
        ? out
        : fallback ?? '';
    };

    return {
      ...notification,
      title: tr(i18n.titleKey, notification.title),
      body: tr(i18n.bodyKey, notification.body),
    } as Notification;
  }

  async createNotification(payload: NotificationPayload): Promise<Notification> {
    // When i18n keys are supplied, keep them on the notification so each device
    // can be served the push in its own language at send time. title/body stay
    // as the default (English) text used for the in-app list and as a fallback.
    const metadata =
      payload.titleKey || payload.bodyKey
        ? {
            ...payload.metadata,
            i18n: {
              titleKey: payload.titleKey,
              bodyKey: payload.bodyKey,
              args: payload.args,
            },
          }
        : payload.metadata;

    const notification = this.notificationRepository.create({
      userId: payload.userId,
      title: payload.title,
      body: payload.body,
      type: payload.type,
      metadata,
      status: NotificationStatus.PENDING,
      user: { id: payload.userId } as Account,
    });

    const result = await this.notificationRepository.save(notification);
    this.logger.log(`Notification created for user ${payload.userId}`);
    return result;
  }

  async enqueueNotification(notificationId: string): Promise<void> {
    await this.notificationQueue.add(
      NOTIFICATION_SEND_JOB_NAME,
      { notificationId } as NotificationJobPayload,
      {
        attempts: NOTIFICATION_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: NOTIFICATION_BACKOFF_DELAY_MS,
        },
        removeOnComplete: true,
        // Keep only the most recent failures for debugging. `false` kept EVERY
        // failed job forever: 31 doomed notifications had already piled up
        // 11,651 dead jobs in Redis, which is what starved the connection and
        // triggered the "Queue Redis retry" warnings.
        removeOnFail: { count: 500 },
      },
    );

    this.logger.log(`Notification job enqueued ${notificationId}`);
  }

  async findUserNotifications(
    userId: string,
    query: NotificationQueryDto,
    lang?: string,
  ) {
    const orderByMap = {
      createdAt: 'notification.createdAt',
      sentAt: 'notification.sentAt',
      readAt: 'notification.readAt',
      updatedAt: 'notification.updatedAt',
    } as const;
    const sortBy = orderByMap[query.sortBy ?? 'createdAt'];

    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.deletedAt IS NULL');

    if (query.unreadOnly) {
      qb.andWhere('notification.isRead = false');
    }

    if (query.status) {
      qb.andWhere('notification.status = :status', { status: query.status });
    }

    if (query.type) {
      qb.andWhere('notification.type = :type', { type: query.type });
    }

    qb.orderBy(sortBy, query.order)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((n) => this.localize(n, lang)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async countUnread(userId: string): Promise<{ unread_count: number }> {
    const unread_count = await this.notificationRepository.count({
      where: {
        userId,
        isRead: false,
        deletedAt: IsNull(),
      },
    });
    // Just the data — the controller owns the (translatable) response message,
    // so it is never duplicated here nor nested inside `data`.
    return { unread_count };
  }

  async getNotificationById(
    userId: string,
    id: string,
    lang?: string,
  ): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotificationNotFoundException(id);
    }

    return this.localize(notification, lang);
  }

  async getNotificationByQueueId(id: string): Promise<Notification | null> {
    return this.notificationRepository.findOne({
      where: { id },
    });
  }

  async markAsRead(userId: string, id: string) {
    const notification = await this.getNotificationById(userId, id);
    if (notification.isRead) {
      return { message: 'This notification is already marked as read' };
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await this.notificationRepository.save(notification);
    this.logger.log(`Notification ${id} marked as read`);

    return {
      message: 'Notification marked as read',
    };
  }

  async markAllAsRead(userId: string) {
    await this.notificationRepository.update(
      { userId, isRead: false, deletedAt: IsNull() },
      {
        isRead: true,
        readAt: new Date(),
      },
    );

    this.logger.log(`All notifications marked as read for user ${userId}`);
    return { message: 'All notifications marked as read' };
  }

  async deleteNotification(userId: string, id: string) {
    const result = await this.notificationRepository.delete({ id, userId });
    if (result.affected === 0) {
      throw new NotificationNotFoundException(id);
    }

    this.logger.log(`Notification ${id} deleted for user ${userId}`);
    return { message: 'Notification deleted successfully' };
  }

  async clearAllNotifications(userId: string) {
    await this.notificationRepository.softDelete({ userId });
    this.logger.log(`All notifications soft deleted for user ${userId}`);

    return { message: 'All notifications cleared successfully' };
  }

  async getDeviceTokens(userId: string): Promise<string[]> {
    const devices = await this.userDeviceRepository.find({
      where: { accountId: userId },
    });

    return devices.map((device) => device.fcmToken).filter(Boolean);
  }

  /**
   * Registered devices (token + chosen language) for a user. Used by the sender
   * to localize each push to the device's language.
   */
  async getUserDevices(userId: string): Promise<{ fcmToken: string; language: Language }[]> {
    const devices = await this.userDeviceRepository.find({
      where: { accountId: userId },
    });
    return devices
      .filter((device) => !!device.fcmToken)
      .map((device) => ({ fcmToken: device.fcmToken, language: device.language ?? Language.EN }));
  }

  /**
   * Clears FCM tokens that Firebase reported as permanently dead (app
   * uninstalled or token rotated). The device row stays — so the session and
   * refresh token survive — but it stops receiving pushes until the app
   * registers a fresh token. This is what prevents us from re-sending to a
   * token that can never deliver again.
   */
  async invalidateDeviceTokens(tokens: string[]): Promise<void> {
    if (!tokens.length) {
      return;
    }
    await this.userDeviceRepository.update(
      { fcmToken: In(tokens) },
      { fcmToken: null as unknown as string },
    );
    this.logger.log(`Cleared ${tokens.length} dead FCM token(s)`);
  }

  async markAsSent(notificationId: string): Promise<void> {
    await this.notificationRepository.update(notificationId, {
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    });
  }

  async markAsFailed(notificationId: string, failureReason: string): Promise<void> {
    await this.notificationRepository.update(notificationId, {
      status: NotificationStatus.FAILED,
      failureReason,
    });
  }

  /**
   * Cron job that retries failed notifications every 5 minutes
   * Queries for all notifications with FAILED status and re-enqueues them
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedNotifications(): Promise<void> {
    try {
      winstonLogger.log('info', 'Starting retry of failed notifications...', { channel: 'jobs' });

      // Failed notifications worth retrying (max 100 per run).
      //
      // PERMANENT failures are excluded: re-enqueuing a notification for a user
      // who has no registered device can never succeed, so every run would
      // re-queue it, it would fail again, and this cron would feed itself
      // forever — thousands of doomed jobs hammering Redis and drowning the
      // logs. Those rows stay FAILED and visible; they are simply not retried.
      const failedNotifications = await this.notificationRepository.find({
        where: {
          status: NotificationStatus.FAILED,
          deletedAt: IsNull(),
          failureReason: Not(In(PERMANENT_FAILURE_REASONS)),
        },
        take: 100,
        order: {
          updatedAt: 'ASC',
        },
      });

      if (failedNotifications.length === 0) {
        winstonLogger.log('info', 'No failed notifications to retry', { channel: 'jobs' });
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      // Re-enqueue each failed notification
      for (const notification of failedNotifications) {
        try {
          // Reset status back to PENDING
          notification.status = NotificationStatus.PENDING;
          notification.failureReason = null;
          await this.notificationRepository.save(notification);

          // Re-enqueue the notification
          await this.enqueueNotification(notification.id);
          successCount++;
        } catch (error) {
          errorCount++;
          winstonLogger.error(
            `Failed to retry notification ${notification.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            { channel: 'jobs' },
          );
        }
      }

      winstonLogger.log(
        'info',
        `Retry completed: ${successCount} succeeded, ${errorCount} failed out of ${failedNotifications.length} notifications`,
        { channel: 'jobs' },
      );
    } catch (error) {
      winstonLogger.error(
        `Cron retry job failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { channel: 'jobs' },
      );
    }
  }
}
