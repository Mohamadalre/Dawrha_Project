import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { MediaService } from './media.service';
import { statusMedia, OwnerType, MediaType } from './entities/media.entity';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';

describe('MediaService', () => {
  let service: MediaService;
  let mediaRepo: any;
  let accountRepo: any;
  let cloudinary: any;
  let profileResolver: any;
  let profileRepo: any;

  const file = { buffer: Buffer.from('x') } as any;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    mediaRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    accountRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    cloudinary = {
      uploadFile: jest.fn().mockResolvedValue({ imageUrl: 'new-url', publicId: 'new-pub' }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    profileRepo = { findOne: jest.fn() };
    profileResolver = { getRepo: jest.fn().mockReturnValue(profileRepo) };

    service = new MediaService(mediaRepo, accountRepo, cloudinary, {} as any, {} as any, profileResolver);
  });

  const rejected = {
    id: 'm1',
    status: statusMedia.REJECTED,
    ownerId: 'p1',
    ownerType: OwnerType.FACTORY,
    fileType: MediaType.LICENSE,
    publicId: 'old-pub',
  };

  describe('reuploadRejectedImage', () => {
    it('throws when media is missing', async () => {
      mediaRepo.findOne.mockResolvedValue(null);
      await expect(
        service.reuploadRejectedImage(file, 'm1', 'u1', Role.FACTORY),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-rejected images', async () => {
      mediaRepo.findOne.mockResolvedValue({ ...rejected, status: statusMedia.PENDING });
      await expect(
        service.reuploadRejectedImage(file, 'm1', 'u1', Role.FACTORY),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forbids when the image does not belong to the caller', async () => {
      mediaRepo.findOne.mockResolvedValue(rejected);
      profileRepo.findOne.mockResolvedValue({ id: 'OTHER' }); // not p1
      await expect(
        service.reuploadRejectedImage(file, 'm1', 'u1', Role.FACTORY),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('re-uploads: image → PENDING, account → PENDING_APPROVAL, old file deleted', async () => {
      mediaRepo.findOne.mockResolvedValue(rejected);
      profileRepo.findOne.mockResolvedValue({ id: 'p1' });

      const res = await service.reuploadRejectedImage(file, 'm1', 'u1', Role.FACTORY);

      expect(cloudinary.uploadFile).toHaveBeenCalled();
      expect(mediaRepo.update).toHaveBeenCalledWith('m1', {
        url: 'new-url',
        publicId: 'new-pub',
        status: statusMedia.PENDING,
      });
      expect(accountRepo.update).toHaveBeenCalledWith('u1', {
        accountStatus: AccountStatus.PENDING_APPROVAL,
      });
      expect(cloudinary.deleteFile).toHaveBeenCalledWith('old-pub');
      expect(res.image).toBe('new-url');
    });
  });

  describe('deleteImage', () => {
    it('throws when media is missing', async () => {
      mediaRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteImage('m1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes from DB then Cloudinary', async () => {
      mediaRepo.findOne.mockResolvedValue({ id: 'm1', publicId: 'pub' });
      const res = await service.deleteImage('m1');
      expect(mediaRepo.delete).toHaveBeenCalledWith('m1');
      expect(cloudinary.deleteFile).toHaveBeenCalledWith('pub');
      expect(res.status).toBe('Image deleted successfully');
    });
  });

  describe('lookups', () => {
    it('findById returns the record', async () => {
      mediaRepo.findOne.mockResolvedValue({ id: 'm1' });
      await expect(service.findById('m1')).resolves.toEqual({ id: 'm1' });
    });

    it('findByOwner queries by owner + type ordered newest', async () => {
      mediaRepo.find.mockResolvedValue([{ id: 'm1' }]);
      const res = await service.findByOwner('p1', OwnerType.FACTORY);
      expect(mediaRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'p1', ownerType: OwnerType.FACTORY } }),
      );
      expect(res).toHaveLength(1);
    });
  });
});
