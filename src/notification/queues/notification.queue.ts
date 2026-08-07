export const NOTIFICATION_QUEUE_NAME = 'notification-queue';
export const NOTIFICATION_SEND_JOB_NAME = 'send-notification';
export const NOTIFICATION_MAX_ATTEMPTS = 3;
export const NOTIFICATION_BACKOFF_DELAY_MS = 5000;

/**
 * Failure reasons that can NEVER succeed by retrying.
 *
 * A notification stored with one of these is skipped by the retry cron —
 * otherwise every run would re-enqueue it, it would fail again, and the pair
 * (cron + retries) would loop forever, flooding the logs and hammering Redis.
 * The row still stays FAILED so the failure remains visible for support.
 */
export const PERMANENT_FAILURE_NO_DEVICE = 'No device tokens registered';
/**
 * Every device token FCM knew about was rejected as permanently dead (app
 * uninstalled / token rotated) and has been pruned. Retrying cannot help — the
 * user has no live token — so this is permanent, exactly like NO_DEVICE.
 */
export const PERMANENT_FAILURE_INVALID_TOKENS = 'All device tokens invalid';
export const PERMANENT_FAILURE_REASONS: string[] = [
  PERMANENT_FAILURE_NO_DEVICE,
  PERMANENT_FAILURE_INVALID_TOKENS,
];
