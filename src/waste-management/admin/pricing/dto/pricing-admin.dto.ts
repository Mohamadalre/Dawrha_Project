import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';

/** ISO currency codes are three letters; normalise case so 'jod' == 'JOD'. */
const normalizeCurrency = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

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
 * Correct a live price row IN PLACE — its figure, its currency, or both.
 *
 * Neither is archived, because neither is a commercial price CHANGE: the number
 * was typed wrong, or it was quoted in the wrong currency. Moving a price to a
 * different grade or tier is a different act and goes through the tier route so
 * the old row is archived rather than quietly overwritten. At least one of
 * `price` / `currency` must be sent — the service refuses an empty correction,
 * and a superseded row cannot be corrected at all (it is what orders were
 * actually charged at).
 */
export class CorrectPricingDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  /** The currency this price is quoted in — a 3-letter ISO code, e.g. JOD. */
  @IsOptional()
  @Transform(normalizeCurrency)
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter ISO code, e.g. JOD',
  })
  currency?: string;
}

/**
 * Re-denominate a material's CURRENT price list — the live rows only.
 *
 * The past is left exactly as it was: a superseded row records what an order
 * was actually charged in, so re-labelling its currency would rewrite history.
 * Only the figures in force today move to the new currency. Omit `tier` to
 * re-denominate every live tier at once.
 */
export class UpdateCurrentCurrencyDto {
  @Transform(normalizeCurrency)
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter ISO code, e.g. JOD',
  })
  currency: string;

  /** Omit to re-denominate every live tier together. */
  @IsOptional()
  @IsEnum(PricingTier)
  tier?: PricingTier;
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
