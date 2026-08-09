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

  /**
   * Where to place the stage in the order (1-based). Optional: omitted appends
   * to the end; given, the stage is inserted at that position and the ones at or
   * after it shift down by one.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order?: number;

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
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
