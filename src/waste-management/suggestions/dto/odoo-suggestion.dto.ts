import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * What the Odoo administrator proposes.
 *
 * The category arrives as a NAME, not an id: the two systems name their
 * categories the same way but do not share keys, and asking an Odoo screen to
 * carry a backend uuid would put the mapping in the wrong place. An unmatched
 * name is kept as text on the proposal so the reviewer still reads it.
 */
export class OdooSuggestionDto {
  /** The Odoo record id — the idempotency key for this push. */
  @IsInt()
  odoo_suggestion_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  product_name: string;

  @IsString()
  @IsNotEmpty()
  unit_type: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  category_name?: string;

  /**
   * A category the proposer says does not exist yet.
   *
   * Separate from `category_name` on purpose. That one is matched against the
   * existing categories; this one is a REQUEST for a category that has none to
   * match. Folding both into one field would make an unmatched name
   * indistinguishable from a typo in an existing one — and the reviewer's
   * response to those two is completely different.
   */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  new_category_name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  suggested_by?: string;
}
