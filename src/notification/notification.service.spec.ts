import { Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationStatus } from './enums/notification-status.enum';
import { NotificationType } from './enums/notification-type.enum';
import { NOTIFICATION_SEND_JOB_NAME } from './queues/notification.queue';

describe('NotificationService', () => {
  let service: NotificationService;
  let notificationRepo: any;
  let deviceRepo: any;
  let queue: any;
  let i18n: any;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    notificationRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'n1', ...x })),
      count: jest.fn().mockResolvedValue(3),
    };
    deviceRepo = { find: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job1' }) };
    // Echoes the key back translated as `<lang>:<key>` so a test can assert the
    // reader's language was used to render the notification content.
    i18n = { translate: jest.fn((key, opts) => `${opts?.lang ?? 'en'}:${key}`) };
    service = new NotificationService(notificationRepo, deviceRepo, queue, i18n);
  });

  it('createNotification persists a PENDING notification', async () => {
    const res = await service.createNotification({
      userId: 'u1',
      title: 'مرحبا',
      body: 'تفاصيل',
      type: NotificationType.GENERAL,
    });

    expect(notificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', status: NotificationStatus.PENDING }),
    );
    expect(res.id).toBe('n1');
  });

  it('enqueueNotification queues a send job with retry options', async () => {
    await service.enqueueNotification('n1');
    expect(queue.add).toHaveBeenCalledWith(
      NOTIFICATION_SEND_JOB_NAME,
      { notificationId: 'n1' },
      expect.objectContaining({ attempts: expect.any(Number) }),
    );
  });

  it('countUnread returns the repository count', async () => {
    // countUnread returns the count wrapped with a (translatable) message, not
    // a bare number — the shape the controller returns to the client.
    await expect(service.countUnread('u1')).resolves.toEqual(
      expect.objectContaining({ unread_count: 3 }),
    );
  });

  it('localises notification content to the reader language on display', async () => {
    notificationRepo.findOne = jest.fn().mockResolvedValue({
      id: 'n1',
      userId: 'u1',
      title: 'Truck added', // stored English default
      body: 'A new truck was added',
      metadata: {
        i18n: {
          titleKey: 'notifications.truckAdded.title',
          bodyKey: 'notifications.truckAdded.body',
          args: { plate: 'ABC-1' },
        },
      },
    });

    const ar = await service.getNotificationById('u1', 'n1', 'ar');
    // The reader's language reached I18nService, and the rendered text replaced
    // the stored English default.
    expect(i18n.translate).toHaveBeenCalledWith(
      'translation.notifications.truckAdded.title',
      expect.objectContaining({ lang: 'ar', args: { plate: 'ABC-1' } }),
    );
    expect(ar.title).toBe('ar:translation.notifications.truckAdded.title');
    expect(ar.body).toBe('ar:translation.notifications.truckAdded.body');
  });

  it('falls back to the stored text when a notification carries no i18n keys', async () => {
    notificationRepo.findOne = jest.fn().mockResolvedValue({
      id: 'n2',
      userId: 'u1',
      title: 'Plain title',
      body: 'Plain body',
      metadata: null,
    });
    const res = await service.getNotificationById('u1', 'n2', 'ar');
    expect(res.title).toBe('Plain title');
    expect(res.body).toBe('Plain body');
    expect(i18n.translate).not.toHaveBeenCalled();
  });
});
