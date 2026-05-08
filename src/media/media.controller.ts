import {
  Controller,
  Put,
  Delete,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Param,
  
  
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { Account } from '@src/user/entities/account.entity';

/**
 * Media Controller - Handle image upload/update/delete endpoints
 *
 * Architecture:
 * - All endpoints require JWT authentication
 * - Multer intercepts file with memory storage config
 * - File is validated (size, type) by multer before reaching controller
 * - Service handles Cloudinary upload + DB transaction
 *
 * Endpoints:

 * - PUT    /media/:id            - Update existing image
 * - DELETE /media/:id            - Delete image
 * - GET    /media/owner/:ownerId - Get owner's images
 * - GET    /media/:id            - Get single image details
 */
@Controller('media')
@UseGuards(JwtAuthGuard) // All endpoints require authentication
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(private readonly mediaService: MediaService) {}

 

  /**
   * Update existing image endpoint
   *
   * Request:
   * - Content-Type: multipart/form-data
   * - file: New binary image file
   * - oldPublicId: Cloudinary public ID of old image (for deletion)
   *
   * Response:
   * - 200 OK
   * - { status, image (new URL) }
   *
   * Process:
   * 1. Upload new image to Cloudinary
   * 2. Update database with new URL
   * 3. Delete old image from Cloudinary (non-critical)
   *
   * Errors:
   * - 400 Bad Request - File validation failed
   * - 404 Not Found - Media ID not found
   * - 500 Internal Server Error - Upload failed
   *
   * Example:
   * curl -X PUT http://localhost:3000/media/123e4567-e89b-12d3-a456-426614174000 \
   *   -H "Authorization: Bearer <token>" \
   *   -F "file=@new-profile.jpg" \
   *   -F "oldPublicId=collectors/uuid/ID_CARD/timestamp"
   */
  @Put(':id')
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async updateImage(
    @Param('id') mediaId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('oldPublicId') oldPublicId: string,
    @CurrentUser() user: Account,
  ) {
    this.logger.log(`Image update initiated by user ${user.id} for media ${mediaId}`);

    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!oldPublicId) {
      throw new BadRequestException('oldPublicId is required for update');
    }

    try {
      const result = await this.mediaService.updateImage(file, mediaId, oldPublicId, user.id);
      this.logger.log(`Image updated successfully: ${mediaId}`);
      return result;
    } catch (error:any) {
      this.logger.error(`Update failed:`, error.message);
      throw error;
    }
  }

  /**
   * Delete image endpoint
   *
   * Request:
   * - DELETE /media/:id
   *
   * Response:
   * - 200 OK
   * - { status }
   *
   * Process:
   * 1. Delete from database
   * 2. Delete from Cloudinary
   *
   * Errors:
   * - 404 Not Found - Media ID not found
   * - 500 Internal Server Error - Deletion failed
   *
   * Example:
   * curl -X DELETE http://localhost:3000/media/123e4567-e89b-12d3-a456-426614174000 \
   *   -H "Authorization: Bearer <token>"
   */
  @Delete(':id')
  async deleteImage(
    @Param('id') mediaId: string,
    @CurrentUser() user: Account,
  ) {
    this.logger.log(`Image deletion initiated by user ${user.id} for media ${mediaId}`);

    try {
      const result = await this.mediaService.deleteImage(mediaId);
      this.logger.log(`Image deleted successfully: ${mediaId}`);
      return result;
    } catch (error:any) {
      this.logger.error(`Deletion failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get all images for owner
   *
   * Returns paginated list of owner's images
   *
   * Example:
   * curl http://localhost:3000/media/owner/123e4567-e89b-12d3-a456-426614174000 \
   *   -H "Authorization: Bearer <token>"
   */
  @Get('owner/:ownerId')
  async getOwnerImages(
    @Param('ownerId') ownerId: string,
    @Body('ownerType') ownerType: string,
  ) {
    const images = await this.mediaService.findByOwner(ownerId, ownerType as any);
    return {
      count: images.length,
      data: images,
    };
  }

  /**
   * Get single image details
   *
   * Returns full media record including URL and metadata
   *
   * Example:
   * curl http://localhost:3000/media/123e4567-e89b-12d3-a456-426614174000 \
   *   -H "Authorization: Bearer <token>"
   */
  @Get(':id')
  async getImage(@Param('id') mediaId: string) {
    const media = await this.mediaService.findById(mediaId);
    if (!media) {
      throw new BadRequestException('Media not found');
    }
    return media;
  }
}
