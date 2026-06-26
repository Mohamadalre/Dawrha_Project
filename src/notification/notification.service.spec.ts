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

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    notificationRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'n1', ...x })),
      count: jest.fn().mockResolvedValue(3),
    };
    deviceRepo = { find: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job1' }) };
    service = new NotificationService(notificationRepo, deviceRepo, queue);
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
    await expect(service.countUnread('u1')).resolves.toBe(3);
  });
});
