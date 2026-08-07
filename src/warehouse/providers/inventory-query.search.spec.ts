import { InventoryQueryService } from './inventory-query.service';

/**
 * The warehouse stock listing narrows by MATERIAL NAME.
 *
 * A single letter must return every material whose name contains it
 * (case-insensitive substring), prefix matches first — and, crucially, the
 * pagination has to count the FILTERED set, not the whole warehouse, or the
 * search would page through rows that are not there.
 */
describe('InventoryQueryService.listForWarehouse — material-name search', () => {
  let service: InventoryQueryService;
  let inventoryRepo: any;
  let qb: any;
  let clauses: { clause: string; params: any }[];
  let params: Record<string, any>;

  const build = () => {
    clauses = [];
    params = {};
    // ONE shared query-builder returned by every createQueryBuilder call, so the
    // terminal mocks apply across all three uses (page rows, summary, count) and
    // captured clauses/params accumulate across them.
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn((clause: string, p: any) => {
        clauses.push({ clause, params: p });
        Object.assign(params, p ?? {});
        return qb;
      }),
      setParameter: jest.fn((k: string, v: any) => {
        params[k] = v;
        return qb;
      }),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
    };
    inventoryRepo = {
      createQueryBuilder: jest.fn(() => qb),
      find: jest.fn().mockResolvedValue([]), // page detail rows → empty is fine here
    };
    const warehouseRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'w1', name: 'Damascus', code: 'WHD1', lastOdooSync: null,
      }),
    };
    const productRepo = { find: jest.fn().mockResolvedValue([]) };
    const conditionRepo = { find: jest.fn().mockResolvedValue([]) };
    const conditions = { labelMapFor: jest.fn().mockResolvedValue(new Map()) };
    const units = {
      byId: jest.fn().mockResolvedValue(new Map()),
      byCode: jest.fn().mockResolvedValue(new Map()),
    };
    service = new InventoryQueryService(
      inventoryRepo as any, warehouseRepo as any, productRepo as any,
      conditionRepo as any, conditions as any, units as any,
    );
  };

  beforeEach(build);

  it('applies a case-insensitive CONTAINS filter and a prefix-first order when searching', async () => {
    // pageRows → one material; countMaterials → 3 matches.
    qb.getRawMany.mockResolvedValueOnce([{ odooProductId: 1 }]);
    qb.getRawOne.mockResolvedValue({ count: '3' });

    const res = await service.listForWarehouse('w1', 1, 10, 'pl');

    const contains = clauses.find((c) => /ILIKE :contains/.test(c.clause));
    expect(contains).toBeTruthy();
    expect(params.contains).toBe('%pl%');
    // Prefix rank drives the primary ordering.
    expect(qb.orderBy).toHaveBeenCalledWith(
      expect.stringMatching(/ILIKE :prefix THEN 0 ELSE 1/),
      'ASC',
    );
    expect(params.prefix).toBe('pl%');
    // Pagination reflects the FILTERED count, not the warehouse total.
    expect(res.search).toBe('pl');
    expect(res.pagination.total_count).toBe(3);
  });

  it('matches on a single letter (substring, not whole word)', async () => {
    qb.getRawMany.mockResolvedValueOnce([{ odooProductId: 1 }]);
    qb.getRawOne.mockResolvedValue({ count: '5' });

    await service.listForWarehouse('w1', 1, 10, 'a');
    expect(params.contains).toBe('%a%');
  });

  it('does NOT filter, and counts the whole warehouse, when no term is given', async () => {
    // Only the base warehouse/odoo clauses — no ILIKE, no count query.
    const res = await service.listForWarehouse('w1', 1, 10);

    expect(clauses.some((c) => /ILIKE/.test(c.clause))).toBe(false);
    expect(res.search).toBeNull();
    // countMaterials (getRawOne) must not run without a term.
    expect(qb.getRawOne).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only term as no search', async () => {
    const res = await service.listForWarehouse('w1', 1, 10, '   ');
    expect(clauses.some((c) => /ILIKE/.test(c.clause))).toBe(false);
    expect(res.search).toBeNull();
  });
});
