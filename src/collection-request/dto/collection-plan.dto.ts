import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CollectionPlanFrequency } from '../enums/collection-plan-frequency.enum';

export class CollectionPlanLineDto {
  @IsUUID()
  product_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;
}

export class CreateCollectionPlanDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsEnum(CollectionPlanFrequency)
  frequency: CollectionPlanFrequency;

  /** ISO weekdays 1=Monday..7=Sunday — required when frequency is WEEKLY. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  /** Days of month 1..31 — required when frequency is MONTHLY. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(31, { each: true })
  month_days?: number[];

  /** Local time of day, 'HH:mm' — when the pickup is scheduled. */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  collection_time: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  item_note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollectionPlanLineDto)
  lines: CollectionPlanLineDto[];
}

/** Every field optional — a PATCH edits only what is sent; lines replace the set. */
export class UpdateCollectionPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(CollectionPlanFrequency)
  frequency?: CollectionPlanFrequency;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(31, { each: true })
  month_days?: number[];

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  collection_time?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  item_note?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollectionPlanLineDto)
  lines?: CollectionPlanLineDto[];
}
