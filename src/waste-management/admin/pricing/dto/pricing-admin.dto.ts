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
 * Correct a live price row IN PLACE — its figure only.
 *
 * The number was typed wrong; the row is not archived, because no commercial
 * price CHANGE happened. Moving a price to a different grade or tier is a
 * different act and goes through the tier route so the old row is archived
 * rather than quietly overwritten. A superseded row cannot be corrected at all
 * (it is what orders were actually charged at).
 *
 * Currency is deliberately NOT correctable here: the platform currency is a
 * single central setting (PATCH /v1/admin/platform-settings), so a price is
 * never quoted per-row in its own currency.
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
