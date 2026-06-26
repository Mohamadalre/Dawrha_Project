import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountManagementService } from './account-management.service';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { statusMedia } from '@src/media/entities/media.entity';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('AccountManagementService', () => {
  let service: AccountManagementService;
  let profileResolver: any;
  let profileDataProvider: any;
  let mediaRepo: any;
  let accountRepo: any;
  let statusNotifier: any;
  let profileRepo: any;

  beforeEach(() => {
    profileRepo = { findAndCount: jest.fn(), findOne: jest.fn() };
    profileResolver = { getRepo: jest.fn().mockReturnValue(profileRepo) };
    profileDataProvider = {
      getRelations: jest.fn().mockReturnValue(['account']),
      getMaterialKey: jest.fn().mockReturnValue('factoryMaterial'),
    };
    mediaRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), update: jest.fn() };
    accountRepo = { findOne: jest.fn(), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    statusNotifier = {
      notifyStatusDecision: jest.fn().mockResolvedValue(undefined),
      notifyBlocked: jest.fn().mockResolvedValue(undefined),
      notifyUnblocked: jest.fn().mockResolvedValue(undefined),
    };

    service = new AccountManagementService(
      profileResolver,
      profileDataProvider,
      mediaRepo,
      accountRepo,
      statusNotifier,
    );
  });

  describe('getProfiles', () => {
    it('rejects an invalid status', async () => {
      await expect(
        service.getProfiles(Role.FACTORY, 1, 10, 'NONSENSE' as AccountStatus),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns profileId + account only, filtered by status', async () => {
      profileRepo.findAndCount.mockResolvedValue([
        [{ id: 'p1', account: { id: 'a1', name: 'F' } }],
        1,
      ]);

      const res = await service.getProfiles(Role.FACTORY, 1, 10, AccountStatus.PENDING_APPROVAL);

      expect(profileRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { account: { accountStatus: AccountStatus.PENDING_APPROVAL } } }),
      );
      expect(res.items).toEqual([{ profileId: 'p1', account: { id: 'a1', name: 'F' } }]);
      expect(res.total).toBe(1);
    });

    it('returns all statuses when none provided', async () => {
      profileRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.getProfiles(Role.FACTORY, 1, 10);
      expect(profileRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  describe('getProfileDetails', () => {
    it('returns profile + materials + image ids only', async () => {
      profileRepo.findOne
        .mockResolvedValueOnce({ id: UUID, account: { id: 'a1' } }) // resolveProfile
        .mockResolvedValueOnce({
          id: UUID,
          account: { id: 'a1' },
          factoryMaterial: { id: 'mat1' },
          province: null,
        }); // detail load
      mediaRepo.find.mockResolvedValue([{ id: 'img1', ownerId: UUID }]);

      const res: any = await service.getProfileDetails(UUID);

      expect(res.profileId).toBe(UUID);
      expect(res.materials).toEqual({ id: 'mat1' });
      expect(res.imageIds).toEqual(['img1']);
    });
  });

  describe('getMediaDetails', () => {
    it('throws BadRequest on a non-UUID', async () => {
      await expect(service.getMediaDetails('nope')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('throws NotFound when missing', async () => {
      mediaRepo.findOne.mockResolvedValue(null);
      await expect(service.getMediaDetails(UUID)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('returns the media record', async () => {
      mediaRepo.findOne.mockResolvedValue({ id: UUID, url: 'u' });
      await expect(service.getMediaDetails(UUID)).resolves.toEqual({ id: UUID, url: 'u' });
    });
  });

  describe('updateMediaStatus', () => {
    const dto = (status: statusMedia, description?: string) => ({ status, description } as any);

    it('throws NotFound when media missing', async () => {
      mediaRepo.findOne.mockResolvedValue(null);
      await expect(service.updateMediaStatus(UUID, dto(statusMedia.APPROVED))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('conflicts when media is not pending', async () => {
      mediaRepo.findOne.mockResolvedValue({ id: UUID, status: statusMedia.APPROVED, ownerId: 'p1' });
      await expect(service.updateMediaStatus(UUID, dto(statusMedia.REJECTED))).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects: sets REJECTED + account NEED_CHANGES + notifies with reason', async () => {
      mediaRepo.findOne.mockResolvedValue({ id: UUID, status: statusMedia.PENDING, ownerId: UUID });
      profileRepo.findOne.mockResolvedValue({ id: UUID, account: { id: 'a1' } });

      const res = await service.updateMediaStatus(UUID, dto(statusMedia.REJECTED, 'صورة غير واضحة'));

      expect(mediaRepo.update).toHaveBeenCalledWith(UUID, { status: statusMedia.REJECTED });
      expect(accountRepo.update).toHaveBeenCalledWith('a1', { accountStatus: AccountStatus.NEED_CHANGES });
      expect(statusNotifier.notifyStatusDecision).toHaveBeenCalledWith(
        'a1',
        AccountStatus.NEED_CHANGES,
        'صورة غير واضحة',
      );
      expect(res.message).toBe('Media rejected successfully');
    });

    it('approves: sets APPROVED', async () => {
      mediaRepo.findOne.mockResolvedValue({ id: UUID, status: statusMedia.PENDING, ownerId: UUID });
      profileRepo.findOne.mockResolvedValue({ id: UUID, account: { id: 'a1' } });

      const res = await service.updateMediaStatus(UUID, dto(statusMedia.APPROVED));
      expect(mediaRepo.update).toHaveBeenCalledWith(UUID, { status: statusMedia.APPROVED });
      expect(res.message).toBe('Media approved successfully');
    });
  });

  describe('updateStatus', () => {
    it('approves a pending account and notifies', async () => {
      accountRepo.findOne.mockResolvedValue({ id: UUID, accountStatus: AccountStatus.PENDING_APPROVAL });
      const res = await service.updateStatus(UUID, { status: AccountStatus.ACTIVE } as any);
      expect(accountRepo.update).toHaveBeenCalled();
      expect(statusNotifier.notifyStatusDecision).toHaveBeenCalled();
      expect(res.message).toContain('successfully');
    });

    it('conflicts when the account is not pending approval', async () => {
      accountRepo.findOne.mockResolvedValue({ id: UUID, accountStatus: AccountStatus.ACTIVE });
      await expect(
        service.updateStatus(UUID, { status: AccountStatus.ACTIVE } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('blockStatus', () => {
    it('blocks an ACTIVE account and notifies', async () => {
      accountRepo.findOne.mockResolvedValue({ id: UUID, accountStatus: AccountStatus.ACTIVE });
      const res = await service.blockStatus(UUID, { status: AccountStatus.BLOCKED } as any);
      expect(statusNotifier.notifyBlocked).toHaveBeenCalledWith(UUID, undefined);
      expect(res.message).toBe('Account blocked successfully');
    });

    it('unblocks a BLOCKED account and notifies', async () => {
      accountRepo.findOne.mockResolvedValue({ id: UUID, accountStatus: AccountStatus.BLOCKED });
      const res = await service.blockStatus(UUID, { status: AccountStatus.ACTIVE } as any);
      expect(statusNotifier.notifyUnblocked).toHaveBeenCalledWith(UUID);
      expect(res.message).toBe('Account unblocked successfully');
    });
  });
});
