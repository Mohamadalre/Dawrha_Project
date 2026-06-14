import { Job } from 'bullmq';
import {
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { NotificationService } from '../notification.service';
import { FirebaseService } from '../services/firebase.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import {
  NOTIFICATION_QUEUE_NAME,
} from '../queues/notification.queue';
import { NotificationJobPayload } from '../interfaces/notification-payload.interface';

@Processor(NOTIFICATION_QUEUE_NAME, {
  concurrency: 10,
  stalledInterval: 3000,
  lockDuration: 6000
})
export class NotificationProcessor extends WorkerHost {

  constructor(
    private readonly notificationService: NotificationService,
    private readonly firebaseService: FirebaseService,
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

    const fcmTokens = await this.notificationService.getDeviceTokens(
      notification.userId,
    );

    if (!fcmTokens.length) {
      await this.notificationService.markAsFailed(
        notification.id,
        'No device tokens registered',
      );
      throw new Error('No FCM tokens registered for user');
    }

    try {
      await this.firebaseService.sendToTokens(fcmTokens, {
        userId: notification.userId,
        title: notification.title,
        body: notification.body,
        metadata: notification.metadata ?? {},
        type: notification.type,
      });

      await this.notificationService.markAsSent(notification.id);
      winstonLogger.log('info', `Notification ${notification.id} sent via Firebase`, { channel: 'jobs' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Firebase send failed';
      await this.notificationService.markAsFailed(notification.id, message);
      winstonLogger.error(`Firebase send failed for ${notification.id}: ${message}`, { channel: 'jobs' });
      throw new Error(message);
    }
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

