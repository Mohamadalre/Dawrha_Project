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
  let applicationsCache: any;

  const file = { buffer: Buffer.from('x') } as any;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    mediaRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      // Rejected documents still outstanding after a re-upload. Default 0 =
      // this was the last one, so the account may go back under review.
      count: jest.fn().mockResolvedValue(0),
    };
    accountRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    cloudinary = {
      uploadFile: jest.fn().mockResolvedValue({ imageUrl: 'new-url', publicId: 'new-pub' }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    profileRepo = { findOne: jest.fn() };
    profileResolver = { getRepo: jest.fn().mockReturnValue(profileRepo) };

    // An applicant answering a request moves their own account back into the
    // reviewer's queue, so the cached listings have to be dropped.
    applicationsCache = {
      invalidate: jest.fn().mockResolvedValue(undefined),
    };

    service = new MediaService(
      mediaRepo,
      accountRepo,
      cloudinary,
      {} as any,
      {} as any,
      profileResolver,
      { enqueuePushDriverRequest: jest.fn() } as any,
      applicationsCache,
    );
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
    it('throws 404 when media is missing', async () => {
      mediaRepo.findOne.mockResolvedValue(null);
      await expect(
        service.reuploadRejectedImage(file, 'm1', 'u1', Role.FACTORY),
      ).rejects.toMatchObject({ status: 404 });
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
      // The replacement takes the old one's place, and closes the request it
      // answers — leaving the request open would keep asking for a document
      // that has just arrived.
      expect(mediaRepo.update).toHaveBeenCalledWith('m1', {
        url: 'new-url',
        publicId: 'new-pub',
        status: statusMedia.PENDING,
        reuploadRequestedAt: null,
        reuploadReason: null,
      });
      expect(accountRepo.update).toHaveBeenCalledWith('u1', {
        accountStatus: AccountStatus.PENDING_APPROVAL,
      });
      expect(cloudinary.deleteFile).toHaveBeenCalledWith('old-pub');
      expect(res.image).toBe('new-url');
    });

    it('keeps the account in NEED_CHANGES while another document is still ASKED FOR', async () => {
      mediaRepo.findOne.mockResolvedValue(rejected);
      profileRepo.findOne.mockResolvedValue({ id: 'p1' });
      // One more document is still outstanding after this re-upload.
      mediaRepo.count.mockResolvedValue(1);

      await service.reuploadRejectedImage(file, 'm1', 'u1', Role.FACTORY);

      // The file itself is refreshed…
      expect(mediaRepo.update).toHaveBeenCalledWith('m1', {
        url: 'new-url',
        publicId: 'new-pub',
        status: statusMedia.PENDING,
        reuploadRequestedAt: null,
        reuploadReason: null,
      });
      // …but the account must NOT leave NEED_CHANGES yet, otherwise the
      // applicant loses the "fix your documents" signal.
      expect(accountRepo.update).not.toHaveBeenCalled();
    });

    it('counts what is still REQUESTED, not what is still rejected', async () => {
      // The difference is the trap. A reviewer can now reject a document
      // without asking for it — rejection is silent, requesting it is the
      // deliberate act — so an account can carry a rejected document the
      // applicant was never told about and cannot see. Counting rejections
      // would hold them in NEED_CHANGES for ever, having replaced everything
      // they were actually asked for, with nothing left on their screen to fix.
      mediaRepo.findOne.mockResolvedValue(rejected);
      profileRepo.findOne.mockResolvedValue({ id: 'p1' });

      await service.reuploadRejectedImage(file, 'm1', 'u1', Role.FACTORY);

      const [{ where }] = mediaRepo.count.mock.calls[0];
      expect(where).toHaveProperty('reuploadRequestedAt');
      expect(where).not.toHaveProperty('status');
    });
  });

  describe('deleteImage', () => {
    it('throws 404 when media is missing', async () => {
      mediaRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteImage('m1', 'u1', Role.FACTORY)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('forbids deleting an image the caller does not own', async () => {
      mediaRepo.findOne.mockResolvedValue({ id: 'm1', publicId: 'pub', ownerId: 'p1' });
      profileRepo.findOne.mockResolvedValue({ id: 'OTHER' }); // not p1
      await expect(service.deleteImage('m1', 'u1', Role.FACTORY)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mediaRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes from DB then Cloudinary when the caller owns the image', async () => {
      mediaRepo.findOne.mockResolvedValue({ id: 'm1', publicId: 'pub', ownerId: 'p1' });
      profileRepo.findOne.mockResolvedValue({ id: 'p1' });
      const res = await service.deleteImage('m1', 'u1', Role.FACTORY);
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
