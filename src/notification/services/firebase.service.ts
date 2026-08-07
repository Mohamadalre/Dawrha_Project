import { Inject, Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { NotificationPayload } from '../interfaces/notification-payload.interface';

/**
 * FCM error codes that mean a token will NEVER work again (app uninstalled,
 * token rotated, malformed token). The token must be pruned, not retried.
 * Every other failure (server unavailable, internal, quota) is transient.
 */
const PERMANENT_TOKEN_ERROR_CODES = new Set<string>([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
  'messaging/sender-id-mismatch',
]);

export interface PushDeliveryResult {
  /** Tokens FCM accepted — the push was delivered to these devices. */
  successCount: number;
  failureCount: number;
  /** Tokens FCM rejected as permanently dead — safe to delete from the DB. */
  invalidTokens: string[];
  /**
   * True when at least one failure was transient (server unavailable/internal)
   * and re-sending could succeed. Never set for permanent token errors.
   */
  retriable: boolean;
}

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger('JOBS');

  constructor(
    @Inject('FIREBASE_ADMIN_APP')
    private readonly firebaseApp: admin.app.App,
  ) {}

  /**
   * Sends one multicast push and REPORTS what happened per token instead of
   * throwing on partial failure.
   *
   * Throwing on `failureCount > 0` was the duplicate-delivery bug: a user with
   * two devices (a live phone + an old one whose token had expired) failed the
   * WHOLE job, so BullMQ retries and the 5-minute retry cron re-sent the push —
   * re-delivering it to the live phone that had already received it. Reporting
   * lets the caller mark the notification SENT once anyone receives it and drop
   * only the dead tokens.
   */
  async sendToTokens(
    tokens: string[],
    payload: NotificationPayload,
  ): Promise<PushDeliveryResult> {
    if (!tokens.length) {
      return { successCount: 0, failureCount: 0, invalidTokens: [], retriable: false };
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

    let response: admin.messaging.BatchResponse;
    try {
      response = await this.firebaseApp.messaging().sendEachForMulticast(message);
    } catch (error: unknown) {
      // The whole request failed (auth, network, malformed message). None were
      // delivered; treat as transient so the job can retry the batch.
      const reason = error instanceof Error ? error.message : 'Unknown Firebase error';
      this.logger.error(`FirebaseService.sendToTokens failed: ${reason}`);
      return {
        successCount: 0,
        failureCount: tokens.length,
        invalidTokens: [],
        retriable: true,
      };
    }

    const invalidTokens: string[] = [];
    let retriable = false;

    response.responses.forEach((item, index) => {
      if (item.success) return;
      const code = item.error?.code ?? '';
      if (PERMANENT_TOKEN_ERROR_CODES.has(code)) {
        invalidTokens.push(tokens[index]);
      } else {
        // unavailable / internal / quota-exceeded / unknown → worth a retry.
        retriable = true;
      }
    });

    if (response.failureCount > 0) {
      const firstError = response.responses.find((item) => !item.success)?.error;
      this.logger.warn(
        `Firebase multicast: ${response.successCount} delivered, ${response.failureCount} failed ` +
          `(${invalidTokens.length} dead token(s))${firstError ? ` — ${firstError.message}` : ''}`,
      );
    } else {
      this.logger.log(`Firebase push succeeded for ${tokens.length} device(s)`);
    }

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
      retriable,
    };
  }
}
