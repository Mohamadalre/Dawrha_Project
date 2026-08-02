import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { ConditionPriceDto } from './set-pricing.dto';

/**
 * Edits a material's price table — any subset of roles, in one call.
 *
 * The role is NOT a field in the body: it is the key. Sending
 * `{ "factory": [...] }` says which tier is being edited far more plainly than
 * a `role` field alongside a price, and it makes editing two tiers at once the
 * natural thing rather than two round-trips that can half-fail.
 *
 * Omitting a tier leaves it exactly as it was — this is an edit, not a replace.
 * That distinction matters: raising the citizen price should not silently wipe
 * the factory grades that were never mentioned.
 *
 * The SHAPE of each tier is decided by the material, and the service enforces
 * it (see `pricing-shape.ts`):
 *   graded material   → factory / free_facility need one entry PER condition
 *   ungraded material → every tier takes exactly one entry, with no condition
 */
export class UpdatePricingTableDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  individual?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  company?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConditionPriceDto)
  factory?: ConditionPriceDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConditionPriceDto)
  free_facility?: ConditionPriceDto[];

  @IsOptional()
  @IsDateString()
  effective_from?: string;
}
