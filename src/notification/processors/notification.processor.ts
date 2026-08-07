import { Job, UnrecoverableError } from 'bullmq';
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
  PERMANENT_FAILURE_NO_DEVICE,
  PERMANENT_FAILURE_INVALID_TOKENS,
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
      // The row was deleted (user cleared their notifications) between enqueue
      // and processing. It will never come back, so retrying 3× — as a plain
      // Error did — is pure noise. Fail once, permanently.
      throw new UnrecoverableError('Notification not found');
    }

    const devices = await this.notificationService.getUserDevices(notification.userId);

    if (!devices.length) {
      await this.notificationService.markAsFailed(
        notification.id,
        PERMANENT_FAILURE_NO_DEVICE,
      );
      // PERMANENT failure: a user with no registered device will not suddenly
      // have one on attempt 2 or 3. A plain Error made BullMQ retry three
      // times per notification — which, combined with the 5-minute retry cron,
      // produced an endless storm that hammered Redis. UnrecoverableError
      // fails the job at once, with no retry.
      throw new UnrecoverableError(PERMANENT_FAILURE_NO_DEVICE);
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

    // Send to every language group and TALLY the outcome per token instead of
    // aborting on the first failure. Aborting was the duplicate-delivery bug: a
    // single stale token on a second device failed the whole job, so BullMQ and
    // the retry cron re-sent the push to the device that already received it.
    let anyDelivered = false;
    let anyTransientFailure = false;
    const deadTokens: string[] = [];

    try {
      for (const [lang, tokens] of tokensByLang) {
        const { title, body } = this.localize(notification, lang);
        const result = await this.firebaseService.sendToTokens(tokens, {
          userId: notification.userId,
          title,
          body,
          metadata,
          type: notification.type,
        });
        if (result.successCount > 0) anyDelivered = true;
        if (result.retriable) anyTransientFailure = true;
        deadTokens.push(...result.invalidTokens);
      }
    } catch (error: unknown) {
      // Unexpected throw (should not happen — sendToTokens reports instead of
      // throwing), treat as transient so the batch can retry.
      const message = error instanceof Error ? error.message : 'Firebase send failed';
      await this.notificationService.markAsFailed(notification.id, message);
      winstonLogger.error(`Firebase send failed for ${notification.id}: ${message}`, { channel: 'jobs' });
      throw new Error(message);
    }

    // Prune tokens FCM declared permanently dead so we never push to them again.
    if (deadTokens.length) {
      await this.notificationService.invalidateDeviceTokens(deadTokens);
    }

    if (anyDelivered) {
      // At least one live device received it. Mark SENT so neither BullMQ nor
      // the retry cron ever sends it again — no more duplicates on the devices
      // that already got it.
      await this.notificationService.markAsSent(notification.id);
      winstonLogger.log('info', `Notification ${notification.id} sent via Firebase`, { channel: 'jobs' });
      return;
    }

    if (anyTransientFailure) {
      // Nobody received it, but the failure was transient (FCM unavailable) —
      // let BullMQ retry the whole notification.
      await this.notificationService.markAsFailed(notification.id, 'Firebase send failed (transient)');
      winstonLogger.error(`Firebase transient failure for ${notification.id}, will retry`, { channel: 'jobs' });
      throw new Error('Firebase send failed (transient)');
    }

    // Every token was permanently invalid and has now been pruned. Retrying
    // cannot help — the user has no live token left.
    await this.notificationService.markAsFailed(notification.id, PERMANENT_FAILURE_INVALID_TOKENS);
    winstonLogger.info(
      `Notification ${notification.id}: all device tokens invalid, pruned — permanent, not retried`,
      { channel: 'jobs' },
    );
    throw new UnrecoverableError(PERMANENT_FAILURE_INVALID_TOKENS);
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
    // A permanent failure is expected bookkeeping, not an incident: there is
    // simply nobody to push to. Log it at info so real errors stay visible.
    const isPermanent = error instanceof UnrecoverableError;
    const line = `Notification job ${job.id} (${job.name}): ${error.message}`;
    if (isPermanent) {
      winstonLogger.info(`${line} — permanent, not retried`, { channel: 'jobs' });
      return;
    }

    winstonLogger.error(`Notification job failed ${line}`, { channel: 'jobs' });

    // Only announce a retry when one will ACTUALLY happen. The old code always
    // printed "will retry", even for jobs BullMQ had already given up on —
    // which made the log look like an endless loop that wasn't there.
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      winstonLogger.warn(
        `Notification job ${job.id} will retry. Attempt ${job.attemptsMade + 1} / ${attempts}`,
        { channel: 'jobs' },
      );
    } else {
      winstonLogger.warn(
        `Notification job ${job.id} exhausted all ${attempts} attempts`,
        { channel: 'jobs' },
      );
    }
  }
}

