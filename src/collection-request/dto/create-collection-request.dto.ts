import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CollectionRequestLineDto {
  @IsUUID()
  product_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

/**
 * Create a collection request directly — there is no cart in the collection
 * flow. The producer names the materials and quantities; the unit, the price
 * and the weight estimate are all resolved server-side from the catalogue.
 *
 * With no `scheduled_at` the request is IMMEDIATE and enters the dispatch
 * queue at once; with one, it is SCHEDULED and waits for its lead-time window.
 */
export class CreateCollectionRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollectionRequestLineDto)
  lines: CollectionRequestLineDto[];

  @IsOptional()
  @IsISO8601()
  scheduled_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contact_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  contact_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address_text?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;
}

export class CancelCollectionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
