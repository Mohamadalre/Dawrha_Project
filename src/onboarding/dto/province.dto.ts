import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { clampPageParam, MAX_PAGE_LIMIT } from '@src/waste-management/common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Admin creates a governorate (same shape as the seeded ones). */
export class CreateProvinceDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name_en: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name_ar: string;
}

/** Admin renames a governorate — either name alone may be sent. */
export class UpdateProvinceDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name_ar?: string;
}

/** Paging and search for the ADMIN governorate list. */
export class ListProvincesDto {
  @IsOptional()
  @Transform(({ value }) => clampPageParam(value, 1, Number.MAX_SAFE_INTEGER, 1))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => clampPageParam(value, 1, MAX_PAGE_LIMIT, 20))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number = 20;

  /** Matches either language — an admin types what is on their screen. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
