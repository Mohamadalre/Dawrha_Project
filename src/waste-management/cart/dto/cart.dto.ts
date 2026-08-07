import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Add a material to the basket.
 *
 * Only the material and how much — the buyer names nothing else:
 *  - the UNIT is the material's own (never entered; a material has exactly one),
 *  - the PRICE is resolved from the material id: its live offer for the caller's
 *    role if one is running, otherwise the list price — the caller does not opt
 *    into an offer,
 *  - the GRADE is `condition_id`, and it matters ONLY for factory / free-facility
 *    buyers and ONLY when the material is graded; for everyone else it is neither
 *    required nor used.
 */
export class AddToCartDto {
  @IsUUID()
  product_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  /** Grade BY ID — required for factory / free-facility on a graded material. */
  @IsOptional()
  @IsUUID()
  condition_id?: string;
}

/** Editing a basket line changes only how much — never the price or the unit. */
export class UpdateCartItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;
}
