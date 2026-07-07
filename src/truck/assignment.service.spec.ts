import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { TruckStatus } from './enums/truck-status.enum';

/**
 * Unit tests for AssignmentService — assignment rules + derived truck status.
 * Repositories and collaborators are mocked.
 */
describe('AssignmentService', () => {
  let service: AssignmentService;
  let truckRepo: any;
  let assignmentRepo: any;
  let driverRepo: any;
  let shiftRepo: any;
  let notifications: any;

  beforeEach(() => {
    truckRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 't1', status: TruckStatus.ACTIVE, plateNumber: 'ABC-1' }),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    assignmentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'a1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(1),
    };
    driverRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'd1', account: { id: 'acc1' }, assignment: null }),
    };
    shiftRepo = { findOne: jest.fn().mockResolvedValue({ id: 's1' }), count: jest.fn().mockResolvedValue(2) };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };

    service = new AssignmentService(truckRepo, assignmentRepo, driverRepo, shiftRepo, notifications);
  });

  describe('assign', () => {
    const dto = { truckId: 't1', driverId: 'd1', shiftId: 's1' };

    it('rejects a disabled truck', async () => {
      truckRepo.findOne.mockResolvedValueOnce({ id: 't1', status: TruckStatus.DISABLED });
      await expect(service.assign(dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a fully-busy truck', async () => {
      truckRepo.findOne.mockResolvedValueOnce({ id: 't1', status: TruckStatus.FULLY_BUSY });
      await expect(service.assign(dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a driver already assigned', async () => {
      driverRepo.findOne.mockResolvedValueOnce({ id: 'd1', account: { id: 'acc1' }, assignment: { id: 'a0' } });
      await expect(service.assign(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the truck+shift is already taken', async () => {
      assignmentRepo.findOne.mockResolvedValueOnce({ id: 'aX' });
      await expect(service.assign(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('assigns, updates derived status and notifies the driver', async () => {
      assignmentRepo.count.mockResolvedValue(1); // 1 of 2 shifts filled
      const res = await service.assign(dto);

      expect(assignmentRepo.save).toHaveBeenCalled();
      const savedTruck = truckRepo.save.mock.calls[0][0];
      expect(savedTruck.status).toBe(TruckStatus.BUSY_ONE_DRIVER);
      expect(notifications.createNotification).toHaveBeenCalled();
      expect(notifications.enqueueNotification).toHaveBeenCalled();
      expect(res.message).toContain('assigned');
    });

    it('marks the truck FULLY_BUSY when both shifts are filled', async () => {
      assignmentRepo.count.mockResolvedValue(2); // capacity is 2
      await service.assign(dto);
      expect(truckRepo.save.mock.calls[0][0].status).toBe(TruckStatus.FULLY_BUSY);
    });
  });

  describe('unassign', () => {
    it('throws when the driver has no assignment', async () => {
      assignmentRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.unassign('d1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removes the assignment and recomputes status to ACTIVE when none remain', async () => {
      assignmentRepo.findOne.mockResolvedValueOnce({ id: 'a1', truckId: 't1' });
      assignmentRepo.count.mockResolvedValue(0);
      const res = await service.unassign('d1');
      expect(assignmentRepo.delete).toHaveBeenCalledWith('a1');
      expect(truckRepo.save.mock.calls[0][0].status).toBe(TruckStatus.ACTIVE);
      expect(res.message).toContain('removed');
    });
  });

  describe('getMyAssignment', () => {
    it('returns assigned:false when the driver has no truck', async () => {
      driverRepo.findOne.mockResolvedValueOnce({ id: 'd1', assignment: null });
      const res: any = await service.getMyAssignment('acc1');
      expect(res.assigned).toBe(false);
    });

    it('returns the truck + shift without images', async () => {
      driverRepo.findOne.mockResolvedValueOnce({
        id: 'd1',
        assignment: {
          assignedAt: new Date(),
          truck: { id: 't1', plateNumber: 'ABC-1', model: 'Volvo', year: 2020, maxPayloadKg: '1000' },
          shift: { id: 's1', name: 'Morning', startTime: '06:00:00', endTime: '14:00:00' },
        },
      });
      const res: any = await service.getMyAssignment('acc1');
      expect(res.assigned).toBe(true);
      expect(res.truck.plate_number).toBe('ABC-1');
      expect(res.shift.name).toBe('Morning');
      expect(JSON.stringify(res)).not.toContain('image');
    });
  });
});
