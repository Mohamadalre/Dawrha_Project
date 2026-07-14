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



  describe('getById', () => {
    it('throws NotFound for an unknown truck', async () => {
      truckRepo.findOne.mockResolvedValue(null);
      await expect(service.getById('t1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
