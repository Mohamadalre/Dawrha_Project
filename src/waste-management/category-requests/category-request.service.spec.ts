import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CategoryRequestService } from './category-request.service';
import { CategoryRequestStatus } from './enums/category-request-status.enum';
import { Role } from '@src/user/enums/role.enum';

describe('CategoryRequestService', () => {
  let service: CategoryRequestService;
  let requestRepo: any;
  let categoryRepo: any;
  let accountRepo: any;
  let assignedCategories: any;
  let writer: any;
  let notifications: any;
  let cache: any;

  beforeEach(() => {
    requestRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'req1', createdAt: new Date(), ...x })),
      findOne: jest.fn(),
    };
    categoryRepo = { find: jest.fn() };
    accountRepo = { find: jest.fn().mockResolvedValue([{ id: 'admin1' }]) };
    assignedCategories = { getAssignedCategoryIds: jest.fn() };
    writer = { addCategories: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };

    service = new CategoryRequestService(
      requestRepo,
      categoryRepo,
      accountRepo,
      assignedCategories,
      writer,
      notifications,
      cache,
    );
  });

  describe('create', () => {
    it('forbids every role except institutions (citizen/factory/free-facility)', async () => {
      for (const role of [Role.CITIZEN, Role.FACTORY, Role.EXTERNAL_PARTNER]) {
        await expect(
          service.create({ id: 'u1', role }, { categoryIds: ['c1'] }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('rejects invalid/inactive categories', async () => {
      categoryRepo.find.mockResolvedValue([]); // none found
      await expect(
        service.create({ id: 'u1', role: Role.INSTITUTIONS }, { categoryIds: ['c1'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when all requested categories are already assigned', async () => {
      categoryRepo.find.mockResolvedValue([{ id: 'c1' }]);
      assignedCategories.getAssignedCategoryIds.mockResolvedValue(['c1']);
      await expect(
        service.create({ id: 'u1', role: Role.INSTITUTIONS }, { categoryIds: ['c1'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a pending request and notifies admins', async () => {
      categoryRepo.find.mockResolvedValue([{ id: 'c1' }]);
      assignedCategories.getAssignedCategoryIds.mockResolvedValue([]);

      const res = await service.create({ id: 'u1', role: Role.INSTITUTIONS }, { categoryIds: ['c1'] });

      expect(res.request_id).toBe('req1');
      expect(res.status).toBe(CategoryRequestStatus.PENDING);
      expect(notifications.createNotification).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('links categories, marks approved and invalidates the cache', async () => {
      requestRepo.findOne.mockResolvedValue({
        id: 'req1',
        accountId: 'u1',
        role: Role.FACTORY,
        categoryIds: ['c1'],
        status: CategoryRequestStatus.PENDING,
      });
      assignedCategories.getAssignedCategoryIds.mockResolvedValue([]);

      await service.approve('admin1', 'req1');

      expect(writer.addCategories).toHaveBeenCalledWith('u1', Role.FACTORY, ['c1']);
      expect(cache.invalidate).toHaveBeenCalledWith('categories', 'products', 'offers');
      expect(notifications.createNotification).toHaveBeenCalled();
    });

    it('conflicts when the request is not pending', async () => {
      requestRepo.findOne.mockResolvedValue({ status: CategoryRequestStatus.APPROVED });
      await expect(service.approve('admin1', 'req1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('reject', () => {
    it('marks rejected with a reason and notifies the requester', async () => {
      requestRepo.findOne.mockResolvedValue({
        id: 'req1',
        accountId: 'u1',
        role: Role.FACTORY,
        categoryIds: ['c1'],
        status: CategoryRequestStatus.PENDING,
      });

      await service.reject('admin1', 'req1', 'بيانات غير مكتملة');

      const saved = requestRepo.save.mock.calls[0][0];
      expect(saved.status).toBe(CategoryRequestStatus.REJECTED);
      expect(saved.adminReason).toBe('بيانات غير مكتملة');
      expect(notifications.createNotification).toHaveBeenCalled();
    });
  });
});
