jest.mock('argon2', () => ({ hash: jest.fn(), verify: jest.fn() }));

import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserService } from './user.service';
import { Role } from './enums/role.enum';

describe('UserService', () => {
  let service: UserService;
  let accountRepo: any;
  let resolver: any;
  let citizenProfileRepo: any;
  let locationRepo: any;
  let provinceRepo: any;

  beforeEach(() => {
    accountRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    resolver = { getRepo: jest.fn() };
    citizenProfileRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'cp1', ...x })),
    };
    locationRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'loc1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    provinceRepo = { findOne: jest.fn() };
    service = new UserService(accountRepo, resolver, citizenProfileRepo, locationRepo, provinceRepo);
    (argon2.hash as jest.Mock).mockReset();
    (argon2.verify as jest.Mock).mockReset();
  });

  describe('changePassword', () => {
    const dto = { currentPassword: 'old', newPassword: 'newpass12', confirmPassword: 'newpass12' };

    it('rejects when confirmation does not match', async () => {
      await expect(
        service.changePassword('u1', { ...dto, confirmPassword: 'different' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the current password is wrong', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'u1', passwordHash: 'hash' });
      (argon2.verify as jest.Mock).mockResolvedValueOnce(false);
      await expect(service.changePassword('u1', dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hashes and stores a valid new password', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'u1', passwordHash: 'hash' });
      (argon2.verify as jest.Mock)
        .mockResolvedValueOnce(true) // current matches
        .mockResolvedValueOnce(false); // new differs from old
      (argon2.hash as jest.Mock).mockResolvedValue('newhash');

      const res = await service.changePassword('u1', dto);
      expect(accountRepo.update).toHaveBeenCalledWith('u1', { passwordHash: 'newhash' });
      expect(res.message).toContain('successfully');
    });
  });

  describe('getProfile', () => {
    it('returns account without password and no profile for ADMIN', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'a1', name: 'Admin', passwordHash: 'secret' });
      const res: any = await service.getProfile('a1', Role.ADMIN);
      expect(res.profile).toBeNull();
      expect(res.account.passwordHash).toBeUndefined();
      expect(resolver.getRepo).not.toHaveBeenCalled();
    });
  });

  describe('locations (citizen)', () => {
    const dto = { coordinates: [35.9, 31.9], address: 'Amman', descriptionAddress: 'Home', provinceId: 'p1' };

    it('forbids non-citizen roles from adding locations', async () => {
      await expect(service.addLocation('u1', Role.FACTORY, dto as any)).rejects.toMatchObject({
        status: 403,
      });
    });

    it('adds a location for a citizen (creating the profile if needed)', async () => {
      provinceRepo.findOne.mockResolvedValue({ id: 'p1' });
      citizenProfileRepo.findOne.mockResolvedValue(null); // no profile yet → created

      const res = await service.addLocation('u1', Role.CITIZEN, dto as any);

      expect(citizenProfileRepo.save).toHaveBeenCalled(); // profile auto-created
      expect(locationRepo.save).toHaveBeenCalled();
      expect(res.id).toBe('loc1');
    });

    it('rejects an invalid province', async () => {
      provinceRepo.findOne.mockResolvedValue(null);
      await expect(service.addLocation('u1', Role.CITIZEN, dto as any)).rejects.toMatchObject({
        status: 400,
      });
    });
  });
});
