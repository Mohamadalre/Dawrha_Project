import { normalizeSyrianPhoneNumber } from '@src/common/utils/phone-normalization.provider';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Self-service edit of the basic (non-onboarding) account fields.
 * Email is identity and stays immutable; documents/media have their own flow.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => normalizeSyrianPhoneNumber(value)) 
  @Matches(/^9639[3-9][0-9]{7}$/, {
    message: 'The phone number must be a Syrian number',
  })
  phone: string;


  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // The image is DELIBERATELY not editable here. It is a binary asset with a
  // cloud copy to keep in step, so it has its own routes — POST/PATCH/DELETE
  // `user/profile/image` — which upload, replace and clean up the Cloudinary
  // file. Letting this PATCH set a raw `profileImage` URL let a stale or
  // arbitrary link bypass that upload+cleanup path and orphan the old asset.
}
