import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** The largest page size any listing will serve. A larger `limit` is REJECTED
 *  with a 400, not silently capped, so the caller learns the real bound. */
export const MAX_PAGE_LIMIT = 100;

/**
 * Page/limit for every listing, validated as real NUMBERS.
 *
 * `@Type(() => Number)` coerces the query STRING ("15") into a number so a valid
 * page size works — the bug where an un-coerced `limit=15` failed `@IsInt` and
 * returned an empty list is closed by that coercion. Anything that is NOT a
 * number ("abc") becomes NaN and is REJECTED with a clear 400, rather than
 * silently defaulted — a bad request should be told it is bad, not answered with
 * the wrong page. `limit` is bounded to [1, MAX_PAGE_LIMIT]: 100 is accepted,
 * 101+ is a 400 ("limit must not be greater than 100"); `page` starts at 1.
 */
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
  @Max(MAX_PAGE_LIMIT)
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
