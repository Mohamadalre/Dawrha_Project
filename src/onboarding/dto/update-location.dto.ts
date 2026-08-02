import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * Correcting the location of an application that is already under review.
 *
 * Every field is optional (a PATCH), but each one that IS sent must be as valid
 * as it was on the original `LocationDto` — an applicant must not be able to
 * blank out their address by sending an empty string.
 */
export class UpdateLocationDto {
  /** [longitude, latitude] — the same order the onboarding endpoint takes. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  coordinates?: number[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  address?: string;

  @IsOptional()
  @IsString()
  descriptionAddress?: string;

  @IsOptional()
  @IsUUID()
  provinceId?: string;
}
