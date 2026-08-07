// src/media/media.service.ts
import { ForbiddenException, Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull, Not } from 'typeorm';
import { Media, MediaType, OwnerType, statusMedia } from './entities/media.entity';
import {
  AccountNotAwaitingChangesException,
  DuplicateImageTypeException,
  MediaNotFoundException,
  NotYourImageException,
  OnlyRejectedReuploadException,
  ReuploadNotRequestedException,
} from './exceptions/media.exceptions';
import { Account } from '@src/user/entities/account.entity';
import { CommonService } from '@src/common/common.service';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { UploadImageDto } from './dto/upload-image.dto';
import { ProfileResolver } from '@src/user/providers/profile-resolver.privder';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { Role } from '@src/user/enums/role.enum';
import { ApplicationsCacheService } from '@src/account-management/providers/applications-cache.service';


/**
 * Media Service - Handle all media operations
 *
 * Responsibilities:
 * - Upload images to Cloudinary
 * - Save image metadata to database
 * - Delete images from Cloudinary and database
 * - Handle transaction rollback on failure (orphan prevention)
 * - Business logic around image validation and approval
 *
 * Design Pattern:
 * - All database operations use transactions
 * - Cloudinary deletion on failure ensures no orphaned files
 * - Single responsibility: media management
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectRepository(Media)
    private readonly mediaRepository: Repository<Media>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly commonService: CommonService,
    private readonly dataSource: DataSource,
    private readonly profileResolver: ProfileResolver,
    private readonly odooSync: OdooSyncService,
    // The applicant answering a request moves their account back into the
    // review queue, so the reviewer's cached listings have to be dropped —
    // otherwise the queue keeps showing an application that is no longer stuck.
    private readonly applicationsCache: ApplicationsCacheService,
  ) { }

  /**
   * Re-upload a REJECTED image by its owner. Sets the image back to PENDING and
   * the owner account back to PENDING_APPROVAL. Only the owner of the image (the
   * account whose profile owns it) may re-upload, and only rejected images.
   */
  async reuploadRejectedImage(
    file: Express.Multer.File,
    mediaId: string,
    userId: string,
    role: Role,
  ): Promise<{ status: string; image: string }> {
    const media = await this.mediaRepository.findOne({ where: { id: mediaId } });
    if (!media) {
      throw new MediaNotFoundException();
    }
    if (media.status !== statusMedia.REJECTED) {
      // An APPROVED document is settled. Letting it be replaced would let an
      // applicant swap out the very file a reviewer accepted, after the fact,
      // with nothing on the account to show the accepted one ever existed.
      throw new OnlyRejectedReuploadException();
    }

    // REJECTED IS NOT ENOUGH — it must have been ASKED FOR.
    //
    // Rejection is silent by design: a reviewer marks a document unacceptable
    // while still working through the rest, and the applicant is told nothing.
    // So an account can carry a rejected document its owner has never been
    // told about and cannot see on any screen.
    //
    // Without this check, that document is quietly re-uploadable — the
    // applicant replaces a file nobody asked for, the account bounces back to
    // PENDING_APPROVAL mid-review, and the reviewer's half-finished pass is
    // interrupted by a change they did not request and cannot explain.
    //
    // The request is what turns a private finding into something the applicant
    // has been told to act on. Only then may they act.
    if (!media.reuploadRequestedAt) {
      throw new ReuploadNotRequestedException();
    }

    // Ownership: the caller's profile (of its role) must own this media.
    const profile = await this.profileResolver
      .getRepo(role)
      .findOne({ where: { account: { id: userId } } });
    if (!profile || profile.id !== media.ownerId) {
      throw new NotYourImageException();
    }

    // …and the ACCOUNT must be the one waiting on them.
    //
    // Checked separately from the document because they can disagree: an
    // application that was rejected outright, or approved, may still carry a
    // document with an outstanding request on it. Replacing a file then would
    // reopen a decision that has already been taken, from the applicant's side,
    // without the reviewer doing anything.
    const account = await this.accountRepository.findOne({
      where: { id: userId },
    });
    if (account?.accountStatus !== AccountStatus.NEED_CHANGES) {
      throw new AccountNotAwaitingChangesException(account?.accountStatus);
    }

    const oldPublicId = media.publicId;
    const uploadResult = await this.cloudinaryService.uploadFile(
      file,
      media.ownerId,
      media.ownerType,
      media.fileType,
    );

    // The replacement takes the rejected one's place: same row, same file type,
    // so it appears exactly where the old one did on the review screen — and
    // the request it answers is closed.
    await this.mediaRepository.update(mediaId, {
      url: uploadResult.imageUrl,
      publicId: uploadResult.publicId,
      status: statusMedia.PENDING,
      reuploadRequestedAt: null,
      reuploadReason: null,
    });

    // Back to review ONLY once nothing is still ASKED FOR.
    //
    // The test used to be "nothing is left rejected", and that is a different
    // question with a worse answer. A reviewer can now reject a document
    // without asking for it — rejection is silent, requesting it is the
    // deliberate act — so an account can legitimately carry a rejected document
    // the applicant has never been told about and cannot see. Keying the
    // release off rejections would leave that applicant permanently in
    // NEED_CHANGES, having replaced everything they were actually asked for,
    // with nothing on their screen left to fix.
    //
    // Several documents requested at once still behave correctly: replacing the
    // first leaves the others outstanding, so the flag stays until the last one
    // is answered.
    const stillRequested = await this.mediaRepository.count({
      where: {
        ownerId: media.ownerId,
        ownerType: media.ownerType,
        reuploadRequestedAt: Not(IsNull()),
      },
    });
    if (stillRequested === 0) {
      await this.accountRepository.update(userId, {
        accountStatus: AccountStatus.PENDING_APPROVAL,
      });
      // The account moved back into the review queue — every cached listing
      // page for its role is now stale.
      await this.applicationsCache.invalidate(role);
    }

    // Drivers are reviewed in ODOO: re-push the request so the updated
    // documents show up there again for the Odoo admin to re-review.
    if (role === Role.COLLECTOR) {
      await this.odooSync.enqueuePushDriverRequest({ accountId: userId });
    }

    // Remove the old Cloudinary file (non-critical).
    try {
      await this.cloudinaryService.deleteFile(oldPublicId);
    } catch (deleteError) {
      this.logger.warn(`Failed to delete old image ${oldPublicId}:`, deleteError);
    }

    return { status: 'Image re-uploaded successfully', image: uploadResult.imageUrl };
  }

  /**
   * Upload image and save to database
   *
   * Process:
   * 1. Upload file to Cloudinary
   * 2. Check if owner already has image of this type
   * 3. Start database transaction
   * 4. Save media record to database
   * 5. Update account status if needed
   * 6. Commit transaction
   * 7. If any step fails: delete from Cloudinary and rollback DB
   *
   * @param file - Multer file from request
   * @param dto - Upload DTO with ownerId, ownerType, fileType
   * @param userId - Current user ID for status updates
   * @returns Object with status message and image URL
   * @throws BadRequestException - if validation fails
   * @throws ForbiddenException - if duplicate file type
   * @throws InternalServerErrorException - if upload fails
   */
  async uploadImage(
    file: Express.Multer.File,
    dto: UploadImageDto,
    userId: string,
  ): Promise<{ status: string; image?: string; mediaId?: string }> {
    const { ownerId, ownerType, fileType } = dto;

    this.logger.debug(`Starting image upload for owner ${ownerId}, type: ${fileType}`);

    try {


      // Step 1: Check if owner already has image of this type
      await this.validateUniqueImageType(ownerId, fileType);




      // Step 2: Upload to Cloudinary
      const uploadResult = await this.cloudinaryService.uploadFile(
        file,
        ownerId,
        ownerType,
        fileType,
      );


      this.logger.debug(`Image uploaded to Cloudinary: ${uploadResult.publicId}`);

      // Step 3: Start database transaction to ensure consistency
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Step 4: Save media record to database within transaction
        const media = queryRunner.manager.create(Media, {
          url: uploadResult.imageUrl,
          publicId: uploadResult.publicId,
          ownerId,
          ownerType,
          fileType,
          status: statusMedia.PENDING,
        });

        const savedMedia = await queryRunner.manager.save(Media, media);


        this.logger.debug(`Media record saved to database: ${savedMedia.id}`);



        // Step 5: Commit transaction
        await queryRunner.commitTransaction();
        // Step 6: Update account completion status
        const account = await queryRunner.manager.findOne(Account, { where: { id: userId } });
        if (account) {
          const check = await this.areAllImagesApproved(ownerId, ownerType);

          // Step 7: Check if ready for approval
          if (check) {
            await this.commonService.completeStep(account, 'documents');
            const step = await this.commonService.getCurrentStep(account);
            if (step == null) {
              await queryRunner.manager.update(
                Account,
                { id: userId },
                { accountStatus: AccountStatus.PENDING_APPROVAL },
              );
                return {
                  status: 'Your request has been sent,wait for it to be approved',
                  image: uploadResult.imageUrl,
                  mediaId: savedMedia.id,
                };
            }


          }
        }
        this.logger.debug(`Transaction committed for media ${savedMedia.id}`);

        return {
          status: 'Image uploaded successfully',
          image: uploadResult.imageUrl,
          mediaId: savedMedia.id,
        };
      } catch (transactionError) {
        // Rollback transaction on error
        await queryRunner.rollbackTransaction();
        this.logger.error(`Transaction rolled back:`, transactionError);

        // Delete uploaded image from Cloudinary if DB transaction fails
        try {
          await this.cloudinaryService.deleteFile(uploadResult.publicId);
          this.logger.warn(`Orphan file prevented: deleted ${uploadResult.publicId} from Cloudinary`);
        } catch (deleteError) {
          this.logger.error(`Failed to delete orphan file ${uploadResult.publicId}:`, deleteError);
          // Log but don't throw - we've already rolled back DB
        }

        throw new InternalServerErrorException('Failed to save media. Upload rolled back.');
      } finally {
        await queryRunner.release();
      }
    } catch (error) {


      this.logger.error(`Image upload failed:`, error);
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Image upload failed');
    }
  }

  /**
   * Update an existing image
   *
   * Process:
   * 1. Upload new image to Cloudinary
   * 2. Update database with new image data
   * 3. Delete old image from Cloudinary
   *
   * Why this order?
   * - If new upload fails, old image stays safe
   * - If DB update fails, new image is on Cloudinary but we can retry or delete
   * - If old delete fails, it's non-critical (new image is what matters)
   *
   * @param file - New file to upload
   * @param mediaId - ID of media record to update
   * @param oldPublicId - Cloudinary public ID of old image
   * @param userId - Current user ID
   * @returns Updated media record
   */
  async updateImage(
    file: Express.Multer.File,
    mediaId: string,
    oldPublicId: string,
    userId: string,
    role: Role,
  ): Promise<{ status: string; image: string }> {
    this.logger.debug(`Starting image update for media ${mediaId}`);

    try {
      // Find current media record
      const currentMedia = await this.mediaRepository.findOne({ where: { id: mediaId } });
      if (!currentMedia) {
        throw new MediaNotFoundException();
      }

      // Ownership: only the media's owner may update it.
      await this.assertOwnership(currentMedia, userId, role);

      // Step 1: Upload new image
      const uploadResult = await this.cloudinaryService.uploadFile(
        file,
        currentMedia.ownerId,
        currentMedia.ownerType,
        currentMedia.fileType,
      );

      // Step 2: Update database with new image
      await this.mediaRepository.update(mediaId, {
        url: uploadResult.imageUrl,
        publicId: uploadResult.publicId,
      });

      this.logger.debug(`Media record updated: ${mediaId}`);

      // Step 3: Delete old image (non-critical)
      try {
        await this.cloudinaryService.deleteFile(oldPublicId);
        this.logger.debug(`Old image deleted: ${oldPublicId}`);
      } catch (deleteError) {
        this.logger.warn(`Failed to delete old image ${oldPublicId}:`, deleteError);
        // Don't fail the operation if old image deletion fails
      }

      return {
        status: 'Image updated successfully',
        image: uploadResult.imageUrl,
      };
    } catch (error) {
      this.logger.error(`Image update failed:`, error);
      throw error;
    }
  }

  /**
   * Delete image from database and Cloudinary
   *
   * Atomic operation:
   * - Delete from database
   * - Delete from Cloudinary (if DB delete succeeds)
   *
   * @param mediaId - Media record ID
   * @returns Confirmation message
   */
  async deleteImage(mediaId: string, userId: string, role: Role): Promise<{ status: string }> {
    this.logger.debug(`Starting image deletion for media ${mediaId}`);

    try {
      // Find media record
      const media = await this.mediaRepository.findOne({ where: { id: mediaId } });
      if (!media) {
        throw new MediaNotFoundException();
      }

      // Ownership: only the media's owner may delete it.
      await this.assertOwnership(media, userId, role);

      const { publicId } = media;

      // Delete from database first
      await this.mediaRepository.delete(mediaId);
      this.logger.debug(`Media record deleted from database: ${mediaId}`);

      // Delete from Cloudinary
      try {
        await this.cloudinaryService.deleteFile(publicId);
        this.logger.debug(`Image deleted from Cloudinary: ${publicId}`);
      } catch (deleteError) {
        this.logger.warn(`Failed to delete from Cloudinary: ${publicId}`, deleteError);
        // Media is already deleted from DB, Cloudinary cleanup is secondary
      }

      return { status: 'Image deleted successfully' };
    } catch (error) {
      this.logger.error(`Image deletion failed:`, error);
      throw error;
    }
  }





  /**
   * Ensures the media belongs to the caller's profile. The caller's role selects
   * the profile repository (same resolution used by re-upload); the profile id
   * must equal the media's ownerId.
   *
   * @throws ForbiddenException when the media is not owned by the caller
   */
  private async assertOwnership(media: Media, userId: string, role: Role): Promise<void> {
    const profile = await this.profileResolver
      .getRepo(role)
      .findOne({ where: { account: { id: userId } } });
    if (!profile || profile.id !== media.ownerId) {
      throw new NotYourImageException();
    }
  }

  /**
   * Find all images for a specific owner
   *
   * @param ownerId - Owner ID
   * @param ownerType - Type of owner
   * @returns Array of media records
   */
  async findByOwner(ownerId: string, ownerType: OwnerType): Promise<Media[]> {
    return await this.mediaRepository.find({
      where: { ownerId, ownerType },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find media by ID
   *
   * @param mediaId - Media record ID
   * @returns Media record or null
   */
  async findById(mediaId: string): Promise<Media | null> {
    return await this.mediaRepository.findOne({ where: { id: mediaId } });
  }

  /**
   * Find images of specific type for owner
   *
   * @param ownerId - Owner ID
   * @param fileType - Type of file
   * @returns Array of media records
   */
  async findByOwnerAndType(ownerId: string, fileType: MediaType): Promise<Media[]> {
    return await this.mediaRepository.find({
      where: { ownerId, fileType },
    });
  }

  /**
   * Validate that owner doesn't already have this file type
   *
   * Prevents duplicate image types for same owner
   *
   * @param ownerId - Owner ID
   * @param fileType - File type to check
   * @throws ForbiddenException if duplicate exists
   */
  private async validateUniqueImageType(ownerId: string, fileType: MediaType): Promise<void> {
    const existing = await this.mediaRepository.find({
      where: { ownerId, fileType },
    });

    if (existing.length > 0) {
      throw new DuplicateImageTypeException(fileType);
    }
  }

  /**
   * Check if all required images are uploaded and approved
   *
   * Business logic: Different owner types require different numbers of images
   *
   * @param ownerId - Owner ID
   * @param ownerType - Type of owner
   * @returns true if all images approved, false otherwise
   */
  private async areAllImagesApproved(ownerId: string, ownerType: OwnerType): Promise<boolean> {
    const images = await this.mediaRepository.find({
      where: { ownerId },
    });

    if (images.length === 0) return false;

    // Define required image count per owner type
    const requiredCounts = {
      [OwnerType.COLLECTOR]: 2,
      [OwnerType.FACTORY]: 2,
      [OwnerType.INSTITUTIONS]: 1,
    };

    const requiredCount = requiredCounts[ownerType];
    return images.length === requiredCount ? true : false;
  }
}