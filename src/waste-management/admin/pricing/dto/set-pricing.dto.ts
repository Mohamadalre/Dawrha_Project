import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Uppercases condition codes so 'good' and 'GOOD' hit the same row. */
const normalizeConditionCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** One price line of a condition-priced tier (FACTORY / FREE_FACILITY). */
export class ConditionPriceDto {
  @Transform(normalizeConditionCode)
  @IsString()
  @MaxLength(30)
  condition: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;
}

/**
 * Full price list of a product.
 * INDIVIDUAL / COMPANY: one price each (no condition dimension).
 * FACTORY / FREE_FACILITY: a price PER material condition — Odoo invoices
 * these two tiers by grade (excellent/good/...), so the admin enters one
 * price per condition and the whole matrix is pushed to Odoo.
 */
export class SetPricingDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  individual: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  company: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConditionPriceDto)
  factory: ConditionPriceDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConditionPriceDto)
  free_facility: ConditionPriceDto[];

  @IsOptional()
  @IsDateString()
  effective_from?: string;

  @IsOptional()
  @IsDateString()
  effective_until?: string;
}
