import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { IsIsoDateTimeWithOffset } from '@src/common/validators/is-iso-datetime-with-offset.validator';

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

  /**
   * The grade this price applies to, BY ID — required for a GRADED material.
   *
   * A code is unique only within its material ("GOOD" is a different grade for
   * paper than for copper), so an id is the only thing that names one grade
   * for certain. The id is also checked to belong to THIS material: pricing
   * copper's "GOOD" using paper's id would silently misprice every order.
   *
   * Must be omitted for an UNGRADED material and for the INDIVIDUAL and
   * COMPANY tiers, which are priced per material rather than per grade.
   */
  @IsOptional()
  @IsUUID()
  condition_id?: string;

  /** The same grade's code. Accepted for callers written before `condition_id`;
   *  sending both when they disagree is refused rather than resolved. */
  @IsOptional()
  @Transform(normalizeConditionCode)
  @IsString()
  @MaxLength(30)
  condition?: string;

  // Currency is not accepted per price: it comes from the central platform
  // setting (PATCH /v1/admin/platform-settings), never per row.

  @IsOptional()
  @IsIsoDateTimeWithOffset()
  effective_from?: string;

  /**
   * Optional END date, set at the moment the price is added.
   *
   * The price is live from `effective_from` until this instant, then the expiry
   * job sweeps it to history and the material falls out of the catalogues for
   * that tier. Omit for an open-ended price (the usual case). Must be in the
   * future — a past end date is rejected rather than creating a price already
   * dead on arrival.
   */
  @IsOptional()
  @IsIsoDateTimeWithOffset()
  effective_until?: string;
}
