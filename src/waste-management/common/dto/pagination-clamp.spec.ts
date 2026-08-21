import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  clampPageParam,
  MAX_PAGE_LIMIT,
  PaginationQueryDto,
} from './pagination.dto';
import { CategoryQueryDto } from '../../catalog/dto/catalog-query.dto';
import { NotificationQueryDto } from '../../../notification/dto/notification-query.dto';
import { AccountListQueryDto } from '../../../account-management/dto/update-account-status.dto';
import { ListStagesQueryDto } from '../../../stages/dto/stage.dto';

/**
 * Pagination must NEVER 400 on a bad or over-cap number.
 *
 * A rejected page/limit surfaces to the user as an EMPTY list ("there is
 * nothing here") rather than an error they can read — the exact bug where
 * asking for `limit=15` on a route whose DTO didn't coerce the query string, or
 * `limit=500` on a capped route, returned nothing. Every paginated DTO clamps
 * instead: floor to an int, bound to [min, max], default anything non-numeric.
 * These tests pin that on the shared helper AND on the DTOs that used to differ.
 */
describe('pagination clamp', () => {
  describe('clampPageParam', () => {
    it('clamps an over-cap value down to the max instead of failing', () => {
      expect(clampPageParam(500, 1, MAX_PAGE_LIMIT, 10)).toBe(MAX_PAGE_LIMIT);
    });
    it('passes a value inside the range through unchanged (e.g. 15)', () => {
      expect(clampPageParam('15', 1, MAX_PAGE_LIMIT, 10)).toBe(15);
    });
    it('floors decimals and lifts below-min to the min', () => {
      expect(clampPageParam('3.9', 1, MAX_PAGE_LIMIT, 10)).toBe(3);
      expect(clampPageParam(0, 1, MAX_PAGE_LIMIT, 10)).toBe(1);
    });
    it('defaults anything non-numeric', () => {
      expect(clampPageParam('abc', 1, MAX_PAGE_LIMIT, 10)).toBe(10);
      expect(clampPageParam(undefined, 1, MAX_PAGE_LIMIT, 10)).toBe(10);
    });
  });

  // Every paginated DTO: a string limit inside the cap survives, an over-cap
  // limit is clamped (not rejected), and the instance validates cleanly.
  const cases: Array<[string, new () => any]> = [
    ['PaginationQueryDto', PaginationQueryDto],
    ['CategoryQueryDto', CategoryQueryDto],
    ['NotificationQueryDto', NotificationQueryDto],
    ['AccountListQueryDto', AccountListQueryDto],
    ['ListStagesQueryDto', ListStagesQueryDto],
  ];

  describe.each(cases)('%s', (_name, Dto) => {
    it('accepts limit=15 as the number 15', async () => {
      const dto = plainToInstance(Dto, { limit: '15', page: '2' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.limit).toBe(15);
      expect(dto.page).toBe(2);
    });

    it('clamps an over-cap limit down to the max rather than 400', async () => {
      const dto = plainToInstance(Dto, { limit: '9999' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.limit).toBe(MAX_PAGE_LIMIT);
    });
  });
});
