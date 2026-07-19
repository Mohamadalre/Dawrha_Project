import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ShiftChangeRequestService } from './shift-change-request.service';
import { ShiftChangeRequestStatus } from './enums/shift-change-request-status.enum';
import { TruckStatus } from './enums/truck-status.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';

describe('ShiftChangeRequestService', () => {
  let service: ShiftChangeRequestService;
  let odooSync: any;
  let requestRepo: any;
  let driverRepo: any;
  let truckRepo: any;
  let shiftRepo: any;
  let assignmentRepo: any;
  let assignmentService: any;
  let notifications: any;

  beforeEach(() => {
    requestRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'r1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    driverRepo = { findOne: jest.fn() };
    truckRepo = { findOne: jest.fn().mockResolvedValue({ id: 't1', status: TruckStatus.ACTIVE, plateNumber: 'ABC-1' }) };
    shiftRepo = { findOne: jest.fn().mockResolvedValue({ id: 's1', shiftType: 'DRIVER', isActive: true }) };
    assignmentRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve(x)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    assignmentService = { recomputeStatus: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };

    odooSync = { enqueuePushShiftChange: jest.fn().mockResolvedValue(undefined) };
    service = new ShiftChangeRequestService(
      requestRepo, driverRepo, truckRepo, shiftRepo, assignmentRepo, assignmentService, notifications, odooSync,
    );
  });

  describe('create', () => {
    const dto = { truckId: 't1', shiftId: 's1' };

    it('forbids a non-active account', async () => {
      driverRepo.findOne.mockResolvedValue({ id: 'd1', account: { accountStatus: AccountStatus.PENDING_APPROVAL } });
      await expect(service.create('acc1', dto)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when an active request already exists', async () => {
      driverRepo.findOne.mockResolvedValue({ id: 'd1', account: { accountStatus: AccountStatus.ACTIVE } });
      requestRepo.findOne.mockResolvedValue({ id: 'r0' });
      await expect(service.create('acc1', dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a PENDING request', async () => {
      driverRepo.findOne.mockResolvedValue({ id: 'd1', account: { accountStatus: AccountStatus.ACTIVE } });
      requestRepo.findOne.mockResolvedValue(null);
      const res = await service.create('acc1', dto);
      expect(requestRepo.save).toHaveBeenCalled();
      expect(requestRepo.create.mock.calls[0][0].status).toBe(ShiftChangeRequestStatus.PENDING);
      expect(res.status).toBe(ShiftChangeRequestStatus.PENDING);
    });
  });

  describe('cancel', () => {
    it('forbids cancelling someone else\'s request', async () => {
      requestRepo.findOne.mockResolvedValue({ id: 'r1', status: ShiftChangeRequestStatus.PENDING, driver: { account: { id: 'other' } } });
      await expect(service.cancel('acc1', 'r1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects cancelling a non-pending request', async () => {
      requestRepo.findOne.mockResolvedValue({ id: 'r1', status: ShiftChangeRequestStatus.PROCESSING, driver: { account: { id: 'acc1' } } });
      await expect(service.cancel('acc1', 'r1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cancels a pending request', async () => {
      requestRepo.findOne.mockResolvedValue({ id: 'r1', status: ShiftChangeRequestStatus.PENDING, driver: { account: { id: 'acc1' } } });
      await service.cancel('acc1', 'r1');
      expect(requestRepo.delete).toHaveBeenCalledWith('r1');
    });
  });


});
