import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** The largest page size any listing will serve. Bigger requests are CAPPED to
 *  this, never rejected — see `clampPageParam`. */
export const MAX_PAGE_LIMIT = 100;

/**
 * Floor a query value to an integer and clamp it into [min, max], falling back
 * to `dflt` for anything non-numeric.
 *
 * The whole point is that pagination NEVER fails on a bad number. A limit above
 * the cap used to be a 400 — and a client that asked for "100 per page" on a
 * 50-cap route got an error and rendered an EMPTY list, which reads to the user
 * as "there is nothing here". Clamping turns "give me 100" into "here are the
 * most I'll serve", which is what the caller actually wanted. `page=0` or
 * `limit=abc` are floored/defaulted the same way instead of blowing up.
 */
export function clampPageParam(
  value: unknown,
  min: number,
  max: number,
  dflt: number,
): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => clampPageParam(value, 1, Number.MAX_SAFE_INTEGER, 1))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => clampPageParam(value, 1, MAX_PAGE_LIMIT, 10))
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
