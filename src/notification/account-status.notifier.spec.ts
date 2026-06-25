import { Logger } from '@nestjs/common';
import { AccountStatusNotifier } from './account-status.notifier';
import { AccountStatus } from '@src/user/enums/account-status.enum';

describe('AccountStatusNotifier', () => {
  let notifier: AccountStatusNotifier;
  let notifications: any;

  beforeEach(() => {
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    notifier = new AccountStatusNotifier(notifications);
  });

  it('notifies the user when their request is submitted for review', async () => {
    await notifier.notifyPendingApproval('acc1');
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'acc1', title: 'طلبك قيد المراجعة' }),
    );
    expect(notifications.enqueueNotification).toHaveBeenCalledWith('n1');
  });

  it('includes the admin reason on rejection', async () => {
    await notifier.notifyStatusDecision('acc1', AccountStatus.REJECTED, 'السجل التجاري غير واضح');
    const payload = notifications.createNotification.mock.calls[0][0];
    expect(payload.title).toBe('تم رفض طلبك');
    expect(payload.body).toContain('السجل التجاري غير واضح');
  });

  it('tells the user which info to edit on NEED_CHANGES', async () => {
    await notifier.notifyStatusDecision('acc1', AccountStatus.NEED_CHANGES, 'حدّث رقم الترخيص');
    const payload = notifications.createNotification.mock.calls[0][0];
    expect(payload.title).toBe('مطلوب تعديل على طلبك');
    expect(payload.body).toContain('حدّث رقم الترخيص');
  });

  it('does not notify for unrelated statuses', async () => {
    await notifier.notifyStatusDecision('acc1', AccountStatus.INACTIVE);
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('notifies on block (with reason) and on unblock', async () => {
    await notifier.notifyBlocked('acc1', 'مخالفة الشروط');
    expect(notifications.createNotification.mock.calls[0][0].title).toBe('تم حظر حسابك');
    expect(notifications.createNotification.mock.calls[0][0].body).toContain('مخالفة الشروط');

    await notifier.notifyUnblocked('acc1');
    expect(notifications.createNotification.mock.calls[1][0].title).toBe('تم رفع الحظر عن حسابك');
  });

  it('is fail-safe: a notification error does not throw', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    notifications.createNotification.mockRejectedValueOnce(new Error('down'));
    await expect(notifier.notifyPendingApproval('acc1')).resolves.toBeUndefined();
  });
});
