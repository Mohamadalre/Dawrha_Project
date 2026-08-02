import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';

/**
 * Give the live price list an end date.
 *
 * Distinct from deleting it. Deleting suspends the material immediately and
 * pulls it out of every catalogue; an expiry leaves it sellable until the date
 * arrives and then stops — which is what a seasonal rate or an ending contract
 * actually is.
 */
export class SetPricingExpiryDto {
  @IsDateString()
  effective_until: string;

  /** Omit to expire every tier together. */
  @IsOptional()
  @IsEnum(PricingTier)
  tier?: PricingTier;
}

/**
 * Correct a price that was typed wrong.
 *
 * Only the figure. Moving a live price to a different grade or tier is not a
 * correction — it is a different price, and it goes through the tier route so
 * the old one is archived rather than quietly overwritten.
 */
export class CorrectPricingDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;
}

/** Paging and the as-of date for the price timeline. */
export class PriceHistoryQueryDto {
  /**
   * "What did we charge on this day?" A price was in force on a date when it
   * started on or before it and had not yet ended.
   */
  @IsOptional()
  @IsDateString()
  as_of?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
