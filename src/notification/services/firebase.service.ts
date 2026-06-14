import { Inject, Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { NotificationPayload } from '../interfaces/notification-payload.interface';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger('JOBS');

  constructor(
    @Inject('FIREBASE_ADMIN_APP')
    private readonly firebaseApp: admin.app.App,
  ) {}

  async sendToTokens(
    tokens: string[],
    payload: NotificationPayload,
  ): Promise<void> {
    if (!tokens.length) {
      throw new Error('No FCM tokens registered for this user');
    }

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      webpush: payload.metadata?.deepLink
        ? {
            fcmOptions: {
              link: payload.metadata.deepLink,
            },
          }
        : undefined,
      android: payload.metadata?.deepLink
        ? {
            notification: {
              clickAction: payload.metadata.deepLink,
            },
          }
        : undefined,
    };

    try {
      const response = await this.firebaseApp.messaging().sendEachForMulticast(message);
      if (response.failureCount > 0) {
        const firstError = response.responses.find((item) => !item.success)?.error;
        const errorReason = firstError?.message ?? 'Partial push failure';
        this.logger.error(`Firebase push failed: ${errorReason}`, errorReason);
        throw new Error(errorReason);
      }

      this.logger.log(
        `Firebase push succeeded for ${tokens.length} device(s)`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Firebase error';
      this.logger.error(`FirebaseService.sendToTokens failed: ${message}`);
      throw new Error(message);
    }
  }
}
