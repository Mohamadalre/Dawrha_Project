// src/media/media.service.ts
import { ForbiddenException, Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Media, MediaType, OwnerType, statusMedia } from './entities/media.entity';
import { Account } from '@src/user/entities/account.entity';
import { CommonService } from '@src/common/common.service';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { UploadImageDto } from './dto/upload-image.dto';

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
    private readonly cloudinaryService: CloudinaryService,
    private readonly commonService: CommonService,
    private readonly dataSource: DataSource,
  ) {}

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
  ): Promise<{ status: string; image: string; mediaId: string }> {
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
          status:statusMedia.PENDING ,
        });

        const savedMedia = await queryRunner.manager.save(Media, media);
        this.logger.debug(`Media record saved to database: ${savedMedia.id}`);

        // Step 5: Update account completion status
        const account = await queryRunner.manager.findOne(Account, { where: { id: userId } });
        if (account) {

          // Step 6: Check if ready for approval
          if (await this.areAllImagesApproved(ownerId, ownerType)) {
            await this.commonService.completeStep(account, 'documents');
            await queryRunner.manager.update(
              Account,
              { id: userId },
              { accountStatus: AccountStatus.PENDING_APPROVAL },
            );

          }
        }

        // Step 7: Commit transaction
        await queryRunner.commitTransaction();
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
      if (error instanceof (BadRequestException || ForbiddenException)) {
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    userId: string,
  ): Promise<{ status: string; image: string }> {
    this.logger.debug(`Starting image update for media ${mediaId}`);

    try {
      // Find current media record
      const currentMedia = await this.mediaRepository.findOne({ where: { id: mediaId } });
      if (!currentMedia) {
        throw new BadRequestException('Media not found');
      }

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
  async deleteImage(mediaId: string): Promise<{ status: string }> {
    this.logger.debug(`Starting image deletion for media ${mediaId}`);

    try {
      // Find media record
      const media = await this.mediaRepository.findOne({ where: { id: mediaId } });
      if (!media) {
        throw new BadRequestException('Media not found');
      }

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
      throw new ForbiddenException(`You already have a ${fileType} image. Update or delete it first.`);
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
      [OwnerType.INSITUTIONS]: 1,
    };

    const requiredCount = requiredCounts[ownerType];
    return images.length == requiredCount ? true : false;
  }
}