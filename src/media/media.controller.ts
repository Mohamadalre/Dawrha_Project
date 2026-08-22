import {
  Controller,
  Put,
  Patch,
  Delete,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Param,
  BadRequestException,
  Logger,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { imageMemoryStorage } from '@src/common/config/multer/image-memory.config';
import { Account } from '@src/user/entities/account.entity';
import { MediaNotFoundException } from './exceptions/media.exceptions';

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
/**
 * Mounted on BOTH `/api/media/...` and `/api/v1/media/...`.
 *
 * Every other controller in the app is versioned, but this one shipped without
 * a version, so clients call the unversioned path. VERSION_NEUTRAL keeps those
 * callers working while `'1'` brings the routes in line with the rest of the
 * API — a consistency fix with no breaking change.
 */
@Controller({ path: 'media', version: [VERSION_NEUTRAL, '1'] })
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
      const result = await this.mediaService.updateImage(file, mediaId, oldPublicId, user.id, (user as any).role);
      this.logger.log(`Image updated successfully: ${mediaId}`);
      return { message: 'Image updated successfully', result };
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
  /**
   * Re-upload a REJECTED image (owner only). Image → PENDING, account →
   * PENDING_APPROVAL. Only works for images whose status is REJECTED.
   */
  @Patch(':id/reupload')
  // The whole point of issuing a token to a non-active account. NEED_CHANGES is
  // the status this route exists for — being told to replace a document and
  // having no way to reach the route that replaces it is a dead end. The other
  // two are here because a rejected document can be replaced while the
  // application is still pending, and a REJECTED application is re-openable in
  // Odoo, at which point the reviewer's next act is asking for the file again.
  @AccountsStatus(
    AccountStatus.NEED_CHANGES,
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.REJECTED,
  )
  @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
  async reuploadImage(
    @Param('id') mediaId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: Account,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.mediaService.reuploadRejectedImage(file, mediaId, user.id, (user as any).role);
  }

  @Delete(':id')
  async deleteImage(
    @Param('id') mediaId: string,
    @CurrentUser() user: Account,
  ) {
    this.logger.log(`Image deletion initiated by user ${user.id} for media ${mediaId}`);

    try {
      const result = await this.mediaService.deleteImage(mediaId, user.id, (user as any).role);
      this.logger.log(`Image deleted successfully: ${mediaId}`);
      return { message: 'Image deleted successfully', result };
    } catch (error:any) {
      this.logger.error(`Deletion failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get all images for an ARBITRARY owner — ADMIN ONLY.
   *
   * This reads any owner's documents by id, so it is gated to the backend admin
   * (the `admin.accounts.view` permission, which only Role.ADMIN holds). Without
   * the gate any authenticated account could read every other account's
   * documents just by passing an owner id. A non-admin who wants their OWN
   * documents uses `GET /account/images`, which resolves the owner from the
   * caller's token and cannot reach anyone else's.
   *
   * Example:
   * curl http://localhost:3000/media/owner/123e4567-e89b-12d3-a456-426614174000 \
   *   -H "Authorization: Bearer <admin-token>"
   */
  @Get('owner/:ownerId')
  @UseGuards(PermissionsGuard)
  @Permissions('admin.accounts.view')
  async getOwnerImages(
    @Param('ownerId') ownerId: string,
    @Body('ownerType') ownerType: string,
  ) {
    const images = await this.mediaService.findByOwner(ownerId, ownerType as any);
    return { message: 'Images fetched successfully', result: { count: images.length, images } };
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
      throw new MediaNotFoundException();
    }
    return { message: 'Media fetched successfully', result: media };
  }
}
