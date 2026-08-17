import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';
import { DeliveryTimeSlotDto } from './delivery-time-slot.dto';

/**
 * Editing the "materials" step of an application that is still under review.
 *
 * Only roles whose onboarding HAS a materials step get one of these —
 * institutions / factories / external partners. A driver (collector) has no
 * materials step at all, so no DTO and no route exist for that role.
 *
 * There is ONE DTO PER ROLE, because the three describe different things and no
 * longer overlap: an institution schedules a pickup, a factory arranges a
 * delivery with detailed windows, and a free facility gives only categories and
 * a quantity. A shared DTO would let a free-facility edit send a factory-only
 * field (and vice-versa) and have it silently accepted.
 *
 * PATCH semantics: send only what changes, but whatever IS sent must be as
 * valid as on first submission.
 */

/** Institutions describe a pickup they want collected. */
export class UpdateMaterialsInstitutionDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  wasteCategoryId?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  estimatedWasteQuantity?: string;

  @IsOptional()
  @IsEnum(CollectionFrequeny)
  collectionFrequney?: CollectionFrequeny;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredCollectionTime?: string[];
}

/**
 * Factories arrange an order to be delivered: categories, a positive quantity,
 * whether they want delivery, and the detailed windows they can receive it in.
 */
export class UpdateMaterialsFactoryDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  wasteCategoryId?: string[];

  @IsOptional()
  @IsNumber({}, { message: 'The estimated order quantity must be a positive number' })
  @IsPositive({ message: 'The estimated order quantity must be a positive number' })
  averageOrderQuantity?: number;

  @IsOptional()
  @IsBoolean()
  deliveryPreference?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryTimeSlotDto)
  deliveryTimeSlots?: DeliveryTimeSlotDto[];
}

/** A free facility (external partner) gives only categories and a positive quantity. */
export class UpdateMaterialsExternalPartnerDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  wasteCategoryId?: string[];

  @IsOptional()
  @IsNumber({}, { message: 'The estimated order quantity must be a positive number' })
  @IsPositive({ message: 'The estimated order quantity must be a positive number' })
  averageOrderQuantity?: number;
}
