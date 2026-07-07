import { NotificationProcessor } from './notification.processor';
import { Language } from '@src/common/enums/language.enum';

/**
 * Unit tests for NotificationProcessor — per-device-language localization.
 */
describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let notificationService: any;
  let firebaseService: any;
  let i18n: any;

  beforeEach(() => {
    notificationService = {
      getNotificationByQueueId: jest.fn(),
      getUserDevices: jest.fn(),
      markAsSent: jest.fn().mockResolvedValue(undefined),
      markAsFailed: jest.fn().mockResolvedValue(undefined),
    };
    firebaseService = { sendToTokens: jest.fn().mockResolvedValue(undefined) };
    // Fake translator: echoes "<lang>:<key>" so we can assert localization.
    i18n = { translate: jest.fn((key: string, opts: any) => `${opts.lang}:${key}`) };

    processor = new NotificationProcessor(notificationService, firebaseService, i18n);
  });

  it('sends a localized push per device language when i18n keys are present', async () => {
    notificationService.getNotificationByQueueId.mockResolvedValue({
      id: 'n1',
      userId: 'u1',
      title: 'Warehouse creation failed',
      body: 'default body',
      type: 'ODOO',
      metadata: {
        i18n: {
          titleKey: 'notifications.warehouseCreateFailed.title',
          bodyKey: 'notifications.warehouseCreateFailed.body',
          args: { name: 'Hub' },
        },
      },
    });
    notificationService.getUserDevices.mockResolvedValue([
      { fcmToken: 't-en', language: Language.EN },
      { fcmToken: 't-ar', language: Language.AR },
    ]);

    await processor.process({ data: { notificationId: 'n1' } } as any);

    // one multicast per language group
    expect(firebaseService.sendToTokens).toHaveBeenCalledTimes(2);

    const calls = firebaseService.sendToTokens.mock.calls;
    const enCall = calls.find((c: any[]) => c[0].includes('t-en'));
    const arCall = calls.find((c: any[]) => c[0].includes('t-ar'));

    expect(enCall[1].body).toBe('en:translation.notifications.warehouseCreateFailed.body');
    expect(arCall[1].body).toBe('ar:translation.notifications.warehouseCreateFailed.body');
    // the i18n routing data must not leak into the push payload
    expect(enCall[1].metadata.i18n).toBeUndefined();
    expect(notificationService.markAsSent).toHaveBeenCalledWith('n1');
  });

  it('falls back to the stored title/body when no i18n keys are present', async () => {
    notificationService.getNotificationByQueueId.mockResolvedValue({
      id: 'n2',
      userId: 'u1',
      title: 'Plain title',
      body: 'Plain body',
      metadata: {},
    });
    notificationService.getUserDevices.mockResolvedValue([
      { fcmToken: 't1', language: Language.AR },
    ]);

    await processor.process({ data: { notificationId: 'n2' } } as any);

    expect(i18n.translate).not.toHaveBeenCalled();
    expect(firebaseService.sendToTokens.mock.calls[0][1].body).toBe('Plain body');
  });

  it('marks the notification failed when the user has no devices', async () => {
    notificationService.getNotificationByQueueId.mockResolvedValue({ id: 'n3', userId: 'u1', metadata: {} });
    notificationService.getUserDevices.mockResolvedValue([]);

    await expect(processor.process({ data: { notificationId: 'n3' } } as any)).rejects.toThrow();
    expect(notificationService.markAsFailed).toHaveBeenCalled();
    expect(firebaseService.sendToTokens).not.toHaveBeenCalled();
  });
});
