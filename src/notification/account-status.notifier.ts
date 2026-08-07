import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { NotificationService } from './notification.service';
import { NotificationType } from './enums/notification-type.enum';

/**
 * Sends account-lifecycle notifications (submitted for review / approved /
 * rejected / changes requested) through the notification module. Failures are
 * swallowed (logged) so they never break the onboarding or admin flow.
 */
@Injectable()
export class AccountStatusNotifier {
  private readonly logger = new Logger(AccountStatusNotifier.name);

  constructor(private readonly notifications: NotificationService) {}

  /** Fired when an account's onboarding is submitted (→ PENDING_APPROVAL). */
  async notifyPendingApproval(accountId: string): Promise<void> {
    await this.send(
      accountId,
      'طلبك قيد المراجعة',
      'تم استلام طلبك وهو الآن قيد مراجعة الإدارة. سنخبرك بالنتيجة قريبًا.',
      { event: AccountStatus.PENDING_APPROVAL },
    );
  }

  /**
   * Fired when an admin decides on a pending account.
   * `description` carries the admin's reason / which items must be edited.
   */
  async notifyStatusDecision(
    accountId: string,
    status: AccountStatus,
    description?: string,
  ): Promise<void> {
    let title: string;
    let body: string;

    switch (status) {
      case AccountStatus.ACTIVE:
        title = 'تم اعتماد حسابك';
        body = 'تمت الموافقة على حسابك ويمكنك الآن استخدام المنصّة.';
        break;
      case AccountStatus.REJECTED:
        title = 'تم رفض طلبك';
        body = description
          ? `تم رفض طلبك. السبب: ${description}`
          : 'تم رفض طلبك. يرجى التواصل مع الدعم لمزيد من التفاصيل.';
        break;
      case AccountStatus.NEED_CHANGES:
        title = 'مطلوب تعديل على طلبك';
        body = description
          ? `يلزم تعديل بعض المعلومات قبل الاعتماد: ${description}`
          : 'يلزم تعديل بعض معلومات حسابك ثم إعادة الإرسال.';
        break;
      default:
        return; // other statuses don't warrant a user notification
    }

    await this.send(accountId, title, body, { event: status, reason: description ?? null });
  }

  /**
   * Fired when the reviewer WITHDRAWS a document request.
   *
   * They asked for something, changed their mind, and are now judging the
   * application on what was already submitted. The applicant has to be told,
   * because until this message arrives their screen still says "upload your
   * licence again" — a demand nobody is waiting on any more, which they will
   * either keep trying to satisfy or read as the app being broken.
   *
   * Deliberately not routed through `notifyStatusDecision`: that method
   * returns silently for PENDING_APPROVAL, so this notice would have been
   * written, sent nowhere, and never missed.
   */
  async notifyReviewResumed(accountId: string, reason?: string): Promise<void> {
    await this.send(
      accountId,
      'لم يعد مطلوباً منك رفع مستندات',
      reason
        ? `تم التراجع عن طلب المستندات وطلبك قيد المراجعة مجدداً. ${reason}`
        : 'تم التراجع عن طلب المستندات، وطلبك قيد المراجعة مجدداً بما قدّمته سابقاً.',
      { event: AccountStatus.PENDING_APPROVAL, reason: reason ?? null },
    );
  }

  /**
   * Fired when a reviewer RE-OPENS a rejected application.
   *
   * The applicant was told they were refused. Reconsidering that without
   * telling them leaves the last thing they heard being a rejection, while the
   * system quietly treats them as an open application again — so they neither
   * know to expect an answer nor that their documents may be looked at afresh.
   */
  async notifyReopened(accountId: string, reason?: string): Promise<void> {
    await this.send(
      accountId,
      'طلبك قيد المراجعة من جديد',
      reason
        ? `تمت إعادة فتح طلبك وسيُراجَع مرة أخرى. ${reason}`
        : 'تمت إعادة فتح طلبك وسيُراجَع مرة أخرى.',
      { event: AccountStatus.PENDING_APPROVAL, reason: reason ?? null },
    );
  }

  /** Fired when an admin blocks an account. */
  async notifyBlocked(accountId: string, reason?: string): Promise<void> {
    await this.send(
      accountId,
      'تم حظر حسابك',
      reason ? `تم حظر حسابك. السبب: ${reason}` : 'تم حظر حسابك. يرجى التواصل مع الدعم.',
      { event: AccountStatus.BLOCKED, reason: reason ?? null },
    );
  }

  /** Fired when an admin lifts a block. */
  async notifyUnblocked(accountId: string): Promise<void> {
    await this.send(
      accountId,
      'تم رفع الحظر عن حسابك',
      'تمت إعادة تفعيل حسابك ويمكنك الآن استخدام المنصّة.',
      { event: 'UNBLOCKED' },
    );
  }

  private async send(
    userId: string,
    title: string,
    body: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      const notification = await this.notifications.createNotification({
        userId,
        title,
        body,
        type: NotificationType.GENERAL,
        metadata,
      });
      await this.notifications.enqueueNotification(notification.id);
    } catch (error) {
      this.logger.warn(`Failed to send status notification to ${userId}`, error as Error);
    }
  }
}
