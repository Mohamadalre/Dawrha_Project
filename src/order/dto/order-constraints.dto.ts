import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SpendingCapPeriod } from '../enums/spending-cap-period.enum';

/**
 * Set/replace the MINIMUM order value for a role (upsert). The role is a path
 * param, so it is not repeated in the body.
 */
export class UpsertOrderMinimumDto {
  /** Floor on the goods total. 0 with is_active=false means "no floor". */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  min_order_value: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/** Set/replace the MAXIMUM spending cap for a role (upsert). */
export class UpsertSpendingCapDto {
  /** Ceiling on goods spend within one window. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  max_amount: number;

  @IsEnum(SpendingCapPeriod)
  period: SpendingCapPeriod;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
