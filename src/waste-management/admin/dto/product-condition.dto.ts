import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const upperCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class AddProductConditionDto {
  @Transform(upperCode)
  @Matches(/^[A-Z0-9_]{1,30}$/, {
    message: 'Condition code must be 1-30 uppercase letters, digits or underscores',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar: string;

  // NOTE: no sort_order. The position is assigned by the system as last + 1.
  // An order the caller chooses is an order two callers can collide on, and the
  // sequence drifts into duplicates nobody notices until a picker renders
  // wrongly. Repositioning has its own route.
}

export class UpdateProductConditionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ReorderConditionDto {
  /** 1-based target position; the other grades shift to make room. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  position: number;
}
