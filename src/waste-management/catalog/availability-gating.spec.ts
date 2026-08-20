import { CatalogService } from './catalog.service';
import { ProductNotFoundException } from '../exceptions/waste.exceptions';

/**
 * Gating rules for the factory / free-facility availability view.
 *
 * `mapAvailability` is a pure grouping-and-gating step over its arguments (it
 * never touches `this`), so it is exercised directly, without standing up the
 * whole CatalogService and its dependency graph. Each test pins one of the
 * rules the feature promises:
 *
 *   - a grade with nothing available is dropped,
 *   - a grade with no live price is dropped,
 *   - a warehouse left empty is dropped,
 *   - a material with no sellable grade anywhere is withheld entirely.
 */
describe('CatalogService availability gating (mapAvailability)', () => {
  const call = (
    rows: any[],
    priceByCondition: Map<string, number>,
  ) =>
    (CatalogService.prototype as any).mapAvailability.call(
      {},
      { id: 'p1', name: 'PET', unitType: 'KG' },
      rows,
      new Map<string, string>(), // labels — irrelevant to gating
      priceByCondition,
      'prov-1',
    );

  const row = (over: Partial<any> = {}) => ({
    warehouseId: 'w1',
    warehouse: { name: 'Damascus WH', code: 'DMS', address: 'A' },
    odooProductId: 300,
    conditionCode: 'EXCELLENT',
    quantity: 100,
    reservedQuantity: 0,
    syncedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });

  it('keeps a grade that is both in stock and priced', () => {
    const res = call([row()], new Map([['EXCELLENT', 10]]));
    expect(res.warehouses).toHaveLength(1);
    expect(res.warehouses[0].conditions).toHaveLength(1);
    expect(res.warehouses[0].conditions[0]).toMatchObject({
      condition: { code: 'EXCELLENT' },
      available: 100,
      price: 10,
    });
    expect(res.total_available).toBe(100);
    expect(res.in_stock).toBe(true);
    expect(res.scope).toBe('PROVINCE');
  });

  it('drops a grade whose quantity is fully reserved (nothing available)', () => {
    const res = call(
      [
        row({ conditionCode: 'EXCELLENT', quantity: 100, reservedQuantity: 0 }),
        row({ conditionCode: 'GOOD', quantity: 40, reservedQuantity: 40 }), // 0 available
      ],
      new Map([
        ['EXCELLENT', 10],
        ['GOOD', 8],
      ]),
    );
    const codes = res.warehouses[0].conditions.map((c: any) => c.condition?.code ?? null);
    expect(codes).toEqual(['EXCELLENT']);
  });

  it('drops a grade with zero quantity', () => {
    const res = call(
      [
        row({ conditionCode: 'EXCELLENT', quantity: 100 }),
        row({ conditionCode: 'POOR', quantity: 0, reservedQuantity: 0 }),
      ],
      new Map([
        ['EXCELLENT', 10],
        ['POOR', 3],
      ]),
    );
    const codes = res.warehouses[0].conditions.map((c: any) => c.condition?.code ?? null);
    expect(codes).toEqual(['EXCELLENT']);
  });

  it('drops a grade that has stock but no live price', () => {
    const res = call(
      [
        row({ conditionCode: 'EXCELLENT', quantity: 100 }),
        row({ conditionCode: 'GOOD', quantity: 50 }), // in stock, but unpriced
      ],
      new Map([['EXCELLENT', 10]]), // GOOD absent → null price
    );
    const codes = res.warehouses[0].conditions.map((c: any) => c.condition?.code ?? null);
    expect(codes).toEqual(['EXCELLENT']);
    expect(res.total_available).toBe(100);
  });

  it('drops a warehouse left with no sellable grade', () => {
    const res = call(
      [
        row({ warehouseId: 'w1', warehouse: { name: 'A', code: 'A' }, conditionCode: 'EXCELLENT', quantity: 100 }),
        row({ warehouseId: 'w2', warehouse: { name: 'B', code: 'B' }, conditionCode: 'GOOD', quantity: 0 }), // empty
      ],
      new Map([
        ['EXCELLENT', 10],
        ['GOOD', 8],
      ]),
    );
    expect(res.warehouses.map((w: any) => w.warehouse_id ?? w.name)).toHaveLength(1);
    expect(res.warehouses[0].name).toBe('A');
  });

  it('withholds the material entirely when NOTHING is sellable (no stock)', () => {
    expect(() => call([], new Map([['EXCELLENT', 10]]))).toThrow(
      ProductNotFoundException,
    );
  });

  it('withholds the material entirely when it has stock but NO price at all', () => {
    expect(() =>
      call([row({ conditionCode: 'EXCELLENT', quantity: 100 })], new Map()),
    ).toThrow(ProductNotFoundException);
  });

  it('prices and keeps a conditionless material by its base price (empty key)', () => {
    const res = call(
      [row({ conditionCode: null, quantity: 70 })],
      new Map([['', 200]]), // base price under the empty key
    );
    expect(res.warehouses[0].conditions[0]).toMatchObject({
      condition: null,
      available: 70,
      price: 200,
    });
  });
});
