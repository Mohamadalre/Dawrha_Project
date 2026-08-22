import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_PAGE_LIMIT } from '@src/waste-management/common/dto/pagination.dto';

/** Coerces the loose truthy/falsey a multipart form or query sends into a boolean. */
const toBool = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return value;
};

export class CreateStageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** First point of the band (inclusive). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPoints: number;

  /** Last point of the band (inclusive). Must be >= minPoints. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPoints: number;

  // No `order` on create: the admin never numbers a new stage by hand. It is
  // appended to the end of the ladder automatically (the next number in the
  // 1..N sequence), and re-ordered afterwards through the dedicated order route.

  /** Defaults to active. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPoints?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPoints?: number;

  /** Move the stage to this position (1-based); others shift to make room. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order?: number;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

/** Admin list query: paginated, with an optional active/inactive filter. */
export class ListStagesQueryDto {
  @IsOptional()
  // Coerced to a number; a non-number ("abc") is a 400, never silently defaulted.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit = 20;

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'all';
}

export class ReorderStageDto {
  /** The stage's new position (1-based). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order: number;
}
