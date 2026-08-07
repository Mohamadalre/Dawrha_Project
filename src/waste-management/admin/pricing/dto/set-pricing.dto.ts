import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Uppercases condition codes so 'good' and 'GOOD' hit the same row. */
const normalizeConditionCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * One price line of a condition-priced tier (FACTORY / FREE_FACILITY).
 *
 * `condition` is OPTIONAL because not every material is graded: a material with
 * no conditions is priced once for the tier and that single line carries no
 * condition code. Odoo shows such a line as the material's plain price. When a
 * tier does send condition codes, the whole list must be condition-coded — the
 * service rejects a mix, since a plain price plus a graded price for the same
 * tier has no defined meaning.
 */
export class ConditionPriceDto {
  /**
   * The grade, BY ID.
   *
   * A code is unique only inside its own material, so "GOOD" is a different
   * grade for paper than for copper and the string alone names neither. An id
   * names one row for good — which matters most here, because this is the
   * table the invoice is read from: a price filed against the wrong grade is
   * money charged for something the buyer did not order.
   *
   * Optional because an UNGRADED material is priced once for the tier, and
   * that single line names no grade at all.
   */
  @IsOptional()
  @IsUUID()
  condition_id?: string;

  /**
   * The same grade's CODE.
   *
   * Still accepted for callers written before the link existed, and resolved
   * to the row so the price is never left unlinked. Sending BOTH is allowed
   * only when they agree — a mismatch is refused rather than settled by
   * precedence, since either could have been the intent and quietly picking
   * one is how a grade gets priced as another.
   */
  @IsOptional()
  @Transform(normalizeConditionCode)
  @IsString()
  @MaxLength(30)
  condition?: string;

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

  /**
   * Graded material: one entry per condition.
   * Ungraded material: exactly ONE entry with no condition — the service
   * enforces which, because only the material knows.
   */
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
