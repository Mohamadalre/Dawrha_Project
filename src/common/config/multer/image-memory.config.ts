import { memoryStorage } from 'multer';
import { BadRequestException } from '@nestjs/common';

/**
 * Memory Storage Multer Configuration
 *
 * Why Memory Storage?
 * - Files are uploaded to Cloudinary immediately
 * - No temporary disk storage needed
 * - Reduced server overhead
 * - Automatic cleanup (file stays in memory during request)
 * - Better performance for concurrent uploads
 *
 * File Size Validation:
 * - Maximum file size: 5MB (5242880 bytes)
 * - Enforced by Multer before it reaches service
 * - Saves bandwidth by rejecting large files early
 *
 * MIME Type Validation:
 * - Only image/jpeg, image/png, image/jpg allowed
 * - Validated via fileFilter callback
 * - Returns clear error message if invalid type
 *
 * Usage:
 * @UseInterceptors(FileInterceptor('file', imageMemoryStorage))
 * async uploadFile(@UploadedFile() file: Express.Multer.File) { ... }
 */

export const imageMemoryStorage = {
  // Use memory storage instead of disk storage
  storage: memoryStorage(),

  // File size limit: 5MB
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB in bytes
  },

  // Filter files by MIME type
  fileFilter: (req: any, file: Express.Multer.File, cb: any) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg'];

    if (!allowedMimes.includes(file.mimetype)) {
      return cb(
        new BadRequestException(
          `Invalid file type. Only JPEG and PNG images are allowed. Received: ${file.mimetype}`,
        ),
        false,
      );
    }

    cb(null, true);
  },
};

/**
 * Alternative: Large file support (up to 50MB)
 * Use this if you need to support larger files
 * Only use if Cloudinary plan allows large files
 */
export const largeFileMemoryStorage = {
  storage: memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req: any, file: Express.Multer.File, cb: any) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new BadRequestException('Only images allowed'), false);
    }
    cb(null, true);
  },
};
