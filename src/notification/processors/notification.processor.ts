import { Job } from 'bullmq';
import {
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { I18nService } from 'nestjs-i18n';
import { NotificationService } from '../notification.service';
import { FirebaseService } from '../services/firebase.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { Language } from '@src/common/enums/language.enum';
import {
  NOTIFICATION_QUEUE_NAME,
} from '../queues/notification.queue';
import {
  NotificationJobPayload,
  NotificationMetadata,
} from '../interfaces/notification-payload.interface';
import { Notification } from '../entities/notification.entity';

@Processor(NOTIFICATION_QUEUE_NAME, {
  concurrency: 10,
  stalledInterval: 3000,
  lockDuration: 6000
})
export class NotificationProcessor extends WorkerHost {

  constructor(
    private readonly notificationService: NotificationService,
    private readonly firebaseService: FirebaseService,
    private readonly i18n: I18nService,
  ) {
    super();
  }
  async process(job: Job<NotificationJobPayload>): Promise<void> {
    const notification = await this.notificationService.getNotificationByQueueId(
      job.data.notificationId,
    );

    if (!notification) {
      winstonLogger.error(
        `Notification job failed because notification does not exist: ${job.data.notificationId}`,
        { channel: 'jobs' }
      );
      throw new Error('Notification not found');
    }

    const devices = await this.notificationService.getUserDevices(notification.userId);

    if (!devices.length) {
      await this.notificationService.markAsFailed(
        notification.id,
        'No device tokens registered',
      );
      throw new Error('No FCM tokens registered for user');
    }

    // Group device tokens by language so each group gets one localized push.
    const tokensByLang = new Map<Language, string[]>();
    for (const device of devices) {
      const tokens = tokensByLang.get(device.language) ?? [];
      tokens.push(device.fcmToken);
      tokensByLang.set(device.language, tokens);
    }

    // The i18n keys are internal routing data — don't leak them into the push.
    const metadata = { ...(notification.metadata ?? {}) };
    delete metadata.i18n;

    try {
      for (const [lang, tokens] of tokensByLang) {
        const { title, body } = this.localize(notification, lang);
        await this.firebaseService.sendToTokens(tokens, {
          userId: notification.userId,
          title,
          body,
          metadata,
          type: notification.type,
        });
      }

      await this.notificationService.markAsSent(notification.id);
      winstonLogger.log('info', `Notification ${notification.id} sent via Firebase`, { channel: 'jobs' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Firebase send failed';
      await this.notificationService.markAsFailed(notification.id, message);
      winstonLogger.error(`Firebase send failed for ${notification.id}: ${message}`, { channel: 'jobs' });
      throw new Error(message);
    }
  }

  /**
   * Resolves the title/body for a given language. Uses the notification's i18n
   * keys when present (translated via I18nService), otherwise the stored text.
   */
  private localize(notification: Notification, lang: Language): { title: string; body: string } {
    const i18n = (notification.metadata as NotificationMetadata | undefined)?.i18n;
    if (!i18n) {
      return { title: notification.title, body: notification.body };
    }

    const title = i18n.titleKey
      ? this.i18n.translate(`translation.${i18n.titleKey}`, { lang, args: i18n.args })
      : notification.title;
    const body = i18n.bodyKey
      ? this.i18n.translate(`translation.${i18n.bodyKey}`, { lang, args: i18n.args })
      : notification.body;

    return { title: String(title), body: String(body) };
  }



  @OnWorkerEvent('active')
  onActive(job: Job) {
    winstonLogger.log('info',
      `Notification queue active job ${job.id} (${job.name}) attempt ${job.attemptsMade + 1}`,
      { channel: 'jobs' }
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    winstonLogger.log('info', `Notification queue completed job ${job.id} (${job.name})`, { channel: 'jobs' });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    winstonLogger.error(
      `Notification job failed ${job.id} (${job.name}): ${error.message}`,
      { channel: 'jobs' }
    );

    const nextAttempt = job.attemptsMade + 1;
    winstonLogger.warn(
      `Notification job ${job.id} failed and will retry. Attempt ${nextAttempt} / ${job.opts.attempts}`,
      { channel: 'jobs' }
    );
  }
}

