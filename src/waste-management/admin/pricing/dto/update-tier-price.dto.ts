import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const normalizeConditionCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Body for editing a single tier's price. The tier comes from the URL.
 * For FACTORY / FREE_FACILITY the `condition` is REQUIRED (those tiers are
 * priced per material condition); for INDIVIDUAL / COMPANY it must be omitted.
 */
export class UpdateTierPriceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @Transform(normalizeConditionCode)
  @IsString()
  @MaxLength(30)
  condition?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  effective_from?: string;
}
