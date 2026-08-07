import { UnrecoverableError } from 'bullmq';
import { NotificationProcessor } from './notification.processor';
import { Language } from '@src/common/enums/language.enum';
import { PERMANENT_FAILURE_INVALID_TOKENS } from '../queues/notification.queue';

/** A fully-delivered multicast result (the common case). */
const delivered = (count = 1) => ({
  successCount: count,
  failureCount: 0,
  invalidTokens: [] as string[],
  retriable: false,
});

/**
 * Unit tests for NotificationProcessor — per-device-language localization plus
 * the partial-failure handling that stops duplicate delivery.
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
      invalidateDeviceTokens: jest.fn().mockResolvedValue(undefined),
    };
    firebaseService = { sendToTokens: jest.fn().mockResolvedValue(delivered()) };
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

  it('fails a missing notification permanently (no retry)', async () => {
    notificationService.getNotificationByQueueId.mockResolvedValue(null);

    await expect(
      processor.process({ data: { notificationId: 'gone' } } as any),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(firebaseService.sendToTokens).not.toHaveBeenCalled();
  });

  it('marks SENT and prunes dead tokens when a push is delivered to at least one device', async () => {
    notificationService.getNotificationByQueueId.mockResolvedValue({
      id: 'n4',
      userId: 'u1',
      title: 't',
      body: 'b',
      metadata: {},
    });
    // Two devices in the same language → one multicast; one token is dead.
    notificationService.getUserDevices.mockResolvedValue([
      { fcmToken: 't-live', language: Language.EN },
      { fcmToken: 't-dead', language: Language.EN },
    ]);
    firebaseService.sendToTokens.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      invalidTokens: ['t-dead'],
      retriable: false,
    });

    // Must NOT throw — a delivery happened, so no retry, no duplicate.
    await processor.process({ data: { notificationId: 'n4' } } as any);

    expect(notificationService.invalidateDeviceTokens).toHaveBeenCalledWith(['t-dead']);
    expect(notificationService.markAsSent).toHaveBeenCalledWith('n4');
    expect(notificationService.markAsFailed).not.toHaveBeenCalled();
  });

  it('fails permanently (no retry) and prunes when every token is invalid', async () => {
    notificationService.getNotificationByQueueId.mockResolvedValue({
      id: 'n5', userId: 'u1', title: 't', body: 'b', metadata: {},
    });
    notificationService.getUserDevices.mockResolvedValue([
      { fcmToken: 't-dead', language: Language.EN },
    ]);
    firebaseService.sendToTokens.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      invalidTokens: ['t-dead'],
      retriable: false,
    });

    await expect(
      processor.process({ data: { notificationId: 'n5' } } as any),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(notificationService.invalidateDeviceTokens).toHaveBeenCalledWith(['t-dead']);
    expect(notificationService.markAsFailed).toHaveBeenCalledWith('n5', PERMANENT_FAILURE_INVALID_TOKENS);
    expect(notificationService.markAsSent).not.toHaveBeenCalled();
  });

  it('retries (plain Error) when the only failure is transient', async () => {
    notificationService.getNotificationByQueueId.mockResolvedValue({
      id: 'n6', userId: 'u1', title: 't', body: 'b', metadata: {},
    });
    notificationService.getUserDevices.mockResolvedValue([
      { fcmToken: 't1', language: Language.EN },
    ]);
    firebaseService.sendToTokens.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      invalidTokens: [],
      retriable: true,
    });

    const err = await processor
      .process({ data: { notificationId: 'n6' } } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
    expect(notificationService.markAsFailed).toHaveBeenCalled();
    expect(notificationService.markAsSent).not.toHaveBeenCalled();
  });
});
