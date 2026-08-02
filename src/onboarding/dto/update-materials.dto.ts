import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';
import { DeliverySchedule } from '@src/user/enums/delivery-schedule.enum';

/**
 * Editing the "materials" step of an application that is still under review.
 *
 * Only roles whose onboarding HAS a materials step get one of these —
 * institutions / factories / external partners. A driver (collector) has no
 * materials step at all, so no DTO and no route exist for that role.
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

/** Factories and external partners describe an order they want delivered. */
export class UpdateMaterialsOrderDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  wasteCategoryId?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  averageOrderQuantity?: string;

  @IsOptional()
  @IsEnum(CollectionFrequeny)
  estimationOrderSchedule?: CollectionFrequeny;

  @IsOptional()
  @IsBoolean()
  deliveryPreference?: boolean;

  @IsOptional()
  @IsEnum(DeliverySchedule)
  perferredDeliverySchedule?: DeliverySchedule;
}
