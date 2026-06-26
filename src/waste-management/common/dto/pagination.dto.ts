import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}

export interface PaginationMeta {
  current_page: number;
  total_pages: number;
  total_count: number;
  limit: number;
  has_next: boolean;
  has_prev: boolean;
}

export function buildPagination(
  totalCount: number,
  page: number,
  limit: number,
): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(totalCount / limit) : 0;
  return {
    current_page: page,
    total_pages: totalPages,
    total_count: totalCount,
    limit,
    has_next: page < totalPages,
    has_prev: page > 1,
  };
}
