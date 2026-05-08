import { IsEnum, IsUUID, IsNotEmpty } from 'class-validator';
import { OwnerType, MediaType } from '../entities/media.entity';

/**
 * Upload Image DTO
 *
 * Validates:
 * - ownerId: Valid UUID
 * - ownerType: Valid enum value
 * - fileType: Valid enum value
 * - File: Validated by Multer interceptor
 *
 * Usage:
 * Automatically validated by ValidationPipe before
 * controller method receives the request
 */
export class UploadImageDto {
  @IsNotEmpty()
  @IsUUID()
  ownerId: string;

  @IsNotEmpty()
  @IsEnum(OwnerType)
  ownerType: OwnerType;

  @IsNotEmpty()
  @IsEnum(MediaType)
  fileType: MediaType;
}


