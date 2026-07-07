import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TruckService } from './truck.service';
import { TruckStatus } from './enums/truck-status.enum';

describe('TruckService', () => {
  let service: TruckService;
  let truckRepo: any;
  let driverRepo: any;
  let cloudinary: any;

  beforeEach(() => {
    truckRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    driverRepo = { createQueryBuilder: jest.fn() };
    cloudinary = { uploadLogo: jest.fn() };

    service = new TruckService(truckRepo, driverRepo, cloudinary);
  });

  describe('setStatus', () => {
    it('throws NotFound for an unknown truck', async () => {
      truckRepo.findOne.mockResolvedValue(null);
      await expect(service.setStatus('t1', { status: TruckStatus.DISABLED })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses to toggle a busy truck', async () => {
      truckRepo.findOne.mockResolvedValue({ id: 't1', status: TruckStatus.BUSY_ONE_DRIVER });
      await expect(service.setStatus('t1', { status: TruckStatus.DISABLED })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('toggles active -> disabled', async () => {
      truckRepo.findOne.mockResolvedValue({ id: 't1', status: TruckStatus.ACTIVE });
      const res = await service.setStatus('t1', { status: TruckStatus.DISABLED });
      expect(res.status).toBe(TruckStatus.DISABLED);
      expect(truckRepo.save).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFound for an unknown truck', async () => {
      truckRepo.findOne.mockResolvedValue(null);
      await expect(service.update('t1', { model: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates only the provided fields', async () => {
      truckRepo.findOne.mockResolvedValueOnce({ id: 't1', model: 'old', year: 2018, plateNumber: 'P1' });
      await service.update('t1', { model: 'new' });
      const saved = truckRepo.save.mock.calls[0][0];
      expect(saved.model).toBe('new');
      expect(saved.year).toBe(2018);
    });
  });

  describe('getById', () => {
    it('throws NotFound for an unknown truck', async () => {
      truckRepo.findOne.mockResolvedValue(null);
      await expect(service.getById('t1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
