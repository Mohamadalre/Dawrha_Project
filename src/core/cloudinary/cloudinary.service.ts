import { Injectable, Inject, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';


export interface CloudinaryUploadResult {
  imageUrl: string;
  publicId: string;
  fileName: string;
  fileSize: number;
}

/**
 * CloudinaryService - Reusable upload/delete operations
 *
 * Single Responsibility: Handle all Cloudinary operations
 * - Upload files to Cloudinary
 * - Delete files from Cloudinary
 * - Manage folder organization
 * - Handle errors and validation
 *
 * All methods are reusable across the application
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly maxFileSize: number;
  private readonly allowedMimeTypes: string[];

  constructor(
    @Inject('CLOUDINARY') private readonly cloudinaryClient: typeof cloudinary,
    private readonly configService: ConfigService,
  ) {
    // Read configuration from environment
    this.maxFileSize = this.configService.get<number>('MAX_FILE_SIZE', 5242880); // 5MB default
    this.allowedMimeTypes = (this.configService.get<string>('ALLOWED_IMAGE_TYPES', 'image/jpeg,image/png,image/jpg') || '').split(',');
  }

  /**
   * Validates file before upload
   * - Checks file size
   * - Checks MIME type
   * - Logs validation errors
   */
  private validateFile(file: Express.Multer.File): void {
    // Validate file exists
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate file size
    if (file.size > this.maxFileSize) {
      const maxSizeMB = this.maxFileSize / (1024 * 1024);
      throw new BadRequestException(`File size exceeds ${maxSizeMB}MB limit`);
    }

    // Validate MIME type
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`File type '${file.mimetype}' is not allowed. Allowed types: ${this.allowedMimeTypes.join(', ')}`);
    }
  }

  /**
   * Builds the public ID (folder structure) for Cloudinary
   *
   * Examples:
   * - collectors/123-uuid/ID_CARD/timestamp
   * - institutions/456-uuid/LICENSE/timestamp
   * - factories/789-uuid/INDUSTRIAL_REG/timestamp
   *
   * @param ownerId - User/Institution/Factory ID
   * @param ownerType - Type of owner
   * @param fileType - Type of file
   * @returns Public ID for Cloudinary
   */
  private buildPublicId(ownerId: string, ownerType: string, fileType: string): string {
    const timestamp = Date.now();
    const ownerTypeFolder = ownerType.toLowerCase();
    return `${ownerTypeFolder}/${fileType}/${ownerId}/${timestamp}`;
  }

  /**
   * Uploads a file to Cloudinary
   *
   * Process:
   * 1. Validate file
   * 2. Create Cloudinary folder structure
   * 3. Upload to Cloudinary
   * 4. Return upload result with imageUrl and publicId
   * 5. On error: throw exception (Cloudinary upload is atomic)
   *
   * @param file - Multer file object
   * @param ownerId - User/Institution/Factory ID
   * @param ownerType - Type of owner (COLLECTOR, INSTITUTIONS, FACTORY)
   * @param fileType - Type of file (ID_CARD, LICENSE, etc.)
   * @returns CloudinaryUploadResult with imageUrl and publicId
   * @throws BadRequestException - if file validation fails
   * @throws InternalServerErrorException - if Cloudinary upload fails
   */
  async uploadFile(
    file: Express.Multer.File,
    ownerId: string,
    ownerType: string,
    fileType: string,
  ): Promise<CloudinaryUploadResult> {
    // Step 1: Validate file before upload
    this.validateFile(file);

    // Step 2: Build public ID with folder structure
    const timestamp = Date.now();
    const ownerTypeFolder = ownerType.toLowerCase();
    const publicId = `${ownerTypeFolder}/${fileType}/${ownerId}/${timestamp}`;
    const folder = `${ownerTypeFolder}/${fileType}`;
    const publicIdRelative = `${ownerId}/${timestamp}`;

 return new Promise((resolve, reject) => {

  const uploadStream =
    this.cloudinaryClient.uploader.upload_stream(

      {
        public_id: publicIdRelative,
        folder,
        resource_type: 'auto',
        overwrite: false,
      },

      (error, result) => {

        if (error || !result) {

          this.logger.error(
            `Upload failed for ${publicId}`,
            error,
          );

          return reject(
            new InternalServerErrorException(
              'Failed to upload file to Cloudinary',
            ),
          );
        }

        this.logger.debug(
         `File uploaded successfully: ${publicId}`,
        );

        resolve({
          imageUrl: result.secure_url,
          publicId: result.public_id,
          fileName:
            result.original_filename ||
            file.originalname,
          fileSize: result.bytes,
        });
      },
    );

  Readable
    .from(file.buffer)
    .pipe(uploadStream);
});
  }

  /**
   * Deletes a file from Cloudinary by public ID
   *
   * Use Cases:
   * - Delete old image when updating profile
   * - Delete uploaded image if database save fails (orphan prevention)
   * - Delete image when user deletes record
   *
   * @param publicId - Cloudinary public ID
   * @throws InternalServerErrorException - if deletion fails
   */
  async deleteFile(publicId: string): Promise<void> {
    if (!publicId) {
      this.logger.warn('Attempt to delete file without publicId');
      return;
    }

    try {
         const result = await this.cloudinaryClient.uploader.destroy(publicId);
         ///{invalidate: true, }

      if (result.result === 'ok') {
        this.logger.debug(`File deleted successfully: ${publicId}`);
      } else if (result.result === 'not found') {
        this.logger.warn(`File not found in Cloudinary: ${publicId}`);
      } else {
        throw new Error(`Unexpected result: ${result.result}`);
      }
    } catch (error:any) {
      this.logger.error(`Failed to delete file ${publicId}:`, error);
      throw new InternalServerErrorException(`Failed to delete file from Cloudinary: ${error.message}`);
    }
  }

  /**
   * Recovers a Cloudinary public_id from a secure URL.
   *
   * Our entities store only the delivery URL, never the public_id, so to delete
   * an image we are replacing we have to read the id back out of the URL. A
   * secure URL looks like:
   *   https://res.cloudinary.com/<cloud>/image/upload/[<transforms>/]v<n>/<public_id>.<ext>
   * The public_id is everything after the version segment, minus the extension —
   * and it keeps its folder path (`catalog/image/<id>/<ts>`), which `destroy`
   * needs in full.
   *
   * Returns null when the URL is empty or not a Cloudinary upload URL, so callers
   * can treat "nothing to delete" and "not ours to delete" the same safe way.
   */
  publicIdFromUrl(url?: string | null): string | null {
    if (!url) return null;
    const marker = '/upload/';
    const at = url.indexOf(marker);
    if (at === -1) return null;

    let rest = url.slice(at + marker.length);
    // Drop the query string / fragment if any.
    rest = rest.split('?')[0].split('#')[0];

    const segments = rest.split('/');
    // Drop the version segment (v1699999999) if present.
    if (segments.length && /^v\d+$/.test(segments[0])) segments.shift();
    if (segments.length === 0) return null;

    let publicId = segments.join('/');
    // Strip a trailing file extension from the LAST segment only.
    const dot = publicId.lastIndexOf('.');
    const slash = publicId.lastIndexOf('/');
    if (dot > slash) publicId = publicId.slice(0, dot);

    return publicId || null;
  }

  /**
   * Best-effort delete by URL — derives the public_id and removes the asset,
   * swallowing any failure.
   *
   * Used when an image is being REPLACED: the new upload has already succeeded
   * and been saved, so the old asset is now an orphan. Cleaning it up must never
   * fail the request that replaced it — a leaked Cloudinary asset is a far
   * smaller problem than a 500 on an otherwise-successful edit.
   */
  async deleteByUrl(url?: string | null): Promise<void> {
    const publicId = this.publicIdFromUrl(url);
    if (!publicId) return;
    try {
      await this.deleteFile(publicId);
    } catch (error: any) {
      this.logger.error(`Best-effort delete failed for ${publicId}: ${error?.message}`);
    }
  }

  /**
   * Deletes multiple files from Cloudinary
   *
   * Useful for cleanup operations or bulk deletions
   * Continues even if one deletion fails to ensure cleanup
   *
   * @param publicIds - Array of Cloudinary public IDs
   */
  async deleteMultipleFiles(publicIds: string[]): Promise<void> {
    const deletePromises = publicIds.map((publicId) =>
      this.deleteFile(publicId).catch((error) => {
        this.logger.error(`Failed to delete ${publicId}:`, error);
        // Continue with other deletions even if one fails
      }),
    );

    await Promise.all(deletePromises);
  }

  /**
   * Gets file information from Cloudinary
   * Useful for validation or metadata retrieval
   *
   * @param publicId - Cloudinary public ID
   * @returns File metadata from Cloudinary
   */
  async getFileInfo(publicId: string): Promise<any> {
    try {
      const resource = await this.cloudinaryClient.api.resource(publicId);
      return resource;
    } catch (error) {
      this.logger.error(`Failed to get file info for ${publicId}:`, error);
      return null;
    }
  }

  /**
   * Uploads a logo file to Cloudinary and returns the URL
   *
   * This is a simplified upload method for logos that doesn't create media records.
   * Used for profile logos that are stored directly in the profile entity.
   *
   * @param file - Multer file object
   * @param folder - Folder path in Cloudinary (e.g., 'logos/institutions/123')
   * @returns Image URL from Cloudinary
   * @throws BadRequestException - if file validation fails
   * @throws InternalServerErrorException - if upload fails
   */
  async uploadLogo(file: Express.Multer.File, folder: string): Promise<string> {
    // Step 1: Validate file before upload
    this.validateFile(file);

    try {

    return new Promise<string>((resolve, reject) => {

      const uploadStream =
        this.cloudinaryClient.uploader.upload_stream(

          {
            folder,
            resource_type: 'image',
            overwrite: false,
          },

          (error, result) => {

            if (error || !result) {

              this.logger.error(
                `Logo upload failed for ${folder}`,
                error,
              );

              return reject(
                new InternalServerErrorException(
                  'Failed to upload logo',
                ),
              );
            }

            this.logger.debug(
             ` Logo uploaded successfully: ${result.public_id}`,
            );

            resolve(result.secure_url);
          },
        );

      uploadStream.end(file.buffer);
    });

  } catch (error) {

    this.logger.error(
      'Cloudinary logo upload error',
      error,
    );

    throw new InternalServerErrorException(
      'Failed to upload logo to Cloudinary',
    );
  }
}
}




  