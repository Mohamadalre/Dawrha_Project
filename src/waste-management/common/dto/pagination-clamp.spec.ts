import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_PAGE_LIMIT, PaginationQueryDto } from './pagination.dto';
import { CategoryQueryDto } from '../../catalog/dto/catalog-query.dto';
import { NotificationQueryDto } from '../../../notification/dto/notification-query.dto';
import { AccountListQueryDto } from '../../../account-management/dto/update-account-status.dto';
import { ListStagesQueryDto } from '../../../stages/dto/stage.dto';

/**
 * Pagination is validated as REAL NUMBERS, and a bad value is a 400 — never a
 * silent default that answers the wrong page, and never an un-coerced string
 * that fails `@IsInt` and renders an empty list.
 *
 *   limit=15   → the number 15 (the query string is coerced)
 *   limit=abc  → 400 (not a number)
 *   limit=101  → 400 (over the cap; 100 is the largest served)
 *   page=0     → 400 (pages start at 1)
 *
 * Driven through `plainToInstance` + `validate` — the exact transform+validate
 * pipeline NestJS runs on every request — across every paginated DTO that used
 * to differ, so the behaviour can never drift apart again.
 */
describe('pagination validation', () => {
  const cases: Array<[string, new () => any]> = [
    ['PaginationQueryDto', PaginationQueryDto],
    ['CategoryQueryDto', CategoryQueryDto],
    ['NotificationQueryDto', NotificationQueryDto],
    ['AccountListQueryDto', AccountListQueryDto],
    ['ListStagesQueryDto', ListStagesQueryDto],
  ];

  describe.each(cases)('%s', (_name, Dto) => {
    it('coerces a numeric string limit=15 to the number 15 (no error)', async () => {
      const dto = plainToInstance(Dto, { limit: '15', page: '2' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.limit).toBe(15);
      expect(dto.page).toBe(2);
    });

    it('accepts limit exactly at the cap', async () => {
      const dto = plainToInstance(Dto, { limit: String(MAX_PAGE_LIMIT) });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.limit).toBe(MAX_PAGE_LIMIT);
    });

    it('REJECTS a non-numeric limit with a validation error', async () => {
      const dto = plainToInstance(Dto, { limit: 'abc' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });

    it('REJECTS a limit over the cap', async () => {
      const dto = plainToInstance(Dto, { limit: String(MAX_PAGE_LIMIT + 1) });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });

    it('REJECTS page below 1', async () => {
      const dto = plainToInstance(Dto, { page: '0' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'page')).toBe(true);
    });

    it('uses the defaults when nothing is sent', async () => {
      const dto = plainToInstance(Dto, {});
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.page).toBe(1);
      expect(typeof dto.limit).toBe('number');
    });
  });
});
