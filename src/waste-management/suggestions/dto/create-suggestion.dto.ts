import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * A material suggestion from any buyer role.
 *
 * A NAME, an existing CATEGORY, an optional DESCRIPTION, and one or more image
 * files (which arrive as uploads, not in the body). No unit, no price, no
 * grades: a suggestion is a hint for the admin, not a catalogue row.
 */
export class CreateSuggestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  product_name: string;

  @IsUUID()
  category_id: string;

  /** Free text describing the material — what it is, why it should be added. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
