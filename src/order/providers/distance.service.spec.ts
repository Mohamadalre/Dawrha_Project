import { of, throwError } from 'rxjs';
import { DistanceService } from './distance.service';
import { DistanceSource, isProvisional } from '../enums/distance-source.enum';

/**
 * The contract these tests hold the service to:
 *   Google is the SOURCE OF TRUTH for distance (delivery is charged per km),
 *   a failure produces a PROVISIONAL row rather than a permanent estimate,
 *   and each pair is measured ONCE — never re-billed.
 */
describe('DistanceService', () => {
  const WAREHOUSE = 'wh-1';
  const BUYER = 'buyer-1';

  let cacheRows: any[];
  let cacheRepo: any;
  let warehouseRepo: any;
  let http: any;
  let service: DistanceService;

  const googleOk = (km: number) =>
    of({
      data: {
        status: 'OK',
        rows: [{ elements: [{ status: 'OK', distance: { value: km * 1000 } }] }],
      },
    });

  const build = (apiKey: string | undefined) => {
    const config = { get: () => apiKey } as any;
    return new DistanceService(config, http, cacheRepo, warehouseRepo);
  };

  beforeEach(() => {
    cacheRows = [];
    cacheRepo = {
      find: jest.fn(async () => cacheRows),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn(function (this: any, v: any) {
          cacheRows = cacheRows.filter(
            (r) => !(r.buyerProfileId === v.buyerProfileId && r.warehouseId === v.warehouseId),
          );
          cacheRows.push({ ...v, computedAt: new Date() });
          return this;
        }),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn(async () => undefined),
      })),
    };
    warehouseRepo = {
      // Straight-line shortlist from PostGIS.
      query: jest.fn(async (sql: string) =>
        sql.includes('ST_Y')
          ? [{ lat: 33.5, lng: 36.3 }]
          : [{ warehouse_id: WAREHOUSE, distance_km: '8' }],
      ),
      find: jest.fn(async () => [
        { id: WAREHOUSE, latitude: '33.51', longitude: '36.29' },
      ]),
    };
    http = { get: jest.fn(() => googleOk(12.4)) };
  });

  it('uses the Google road distance, not the straight line, when the API answers', async () => {
    service = build('test-key');
    const ranked = await service.rankWarehouses({
      buyerProfileId: BUYER,
      provinceId: 'p1',
    });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(ranked[0].source).toBe(DistanceSource.GOOGLE);
    // 12.4 from Google, not the 8 PostGIS estimated.
    expect(ranked[0].distanceKm).toBe(12.4);
  });

  it('asks Google in ONE batched request, not once per warehouse', async () => {
    warehouseRepo.query = jest.fn(async (sql: string) =>
      sql.includes('ST_Y')
        ? [{ lat: 33.5, lng: 36.3 }]
        : [
            { warehouse_id: 'a', distance_km: '3' },
            { warehouse_id: 'b', distance_km: '5' },
            { warehouse_id: 'c', distance_km: '9' },
          ],
    );
    warehouseRepo.find = jest.fn(async () => [
      { id: 'a', latitude: '1', longitude: '1' },
      { id: 'b', latitude: '2', longitude: '2' },
      { id: 'c', latitude: '3', longitude: '3' },
    ]);
    http.get = jest.fn(() =>
      of({
        data: {
          status: 'OK',
          rows: [
            {
              elements: [
                { status: 'OK', distance: { value: 4000 } },
                { status: 'OK', distance: { value: 6000 } },
                { status: 'OK', distance: { value: 11000 } },
              ],
            },
          ],
        },
      }),
    );

    service = build('test-key');
    await service.rankWarehouses({ buyerProfileId: BUYER, provinceId: 'p1' });

    // Three warehouses, ONE call — this is the cost control.
    expect(http.get).toHaveBeenCalledTimes(1);
    const destinations = http.get.mock.calls[0][1].params.destinations;
    expect(destinations.split('|')).toHaveLength(3);
  });

  it('never calls Google again for a pair it already measured', async () => {
    service = build('test-key');
    await service.rankWarehouses({ buyerProfileId: BUYER, provinceId: 'p1' });
    expect(http.get).toHaveBeenCalledTimes(1);

    await service.rankWarehouses({ buyerProfileId: BUYER, provinceId: 'p1' });
    // Still one: the cached pair is answered from the database.
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('falls back to a PROVISIONAL estimate when Google fails — never blocks the order', async () => {
    http.get = jest.fn(() => throwError(() => new Error('ETIMEDOUT')));
    service = build('test-key');

    const ranked = await service.rankWarehouses({
      buyerProfileId: BUYER,
      provinceId: 'p1',
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].distanceKm).toBe(8); // the straight line
    expect(ranked[0].source).toBe(DistanceSource.HAVERSINE);
    expect(isProvisional(ranked[0].source)).toBe(true);
  });

  it('UPGRADES a provisional row once Google answers again', async () => {
    // This is the defect the sweep exists for: an earlier version cached the
    // fallback like any other row, so one transient outage pinned the pair to
    // an estimate forever — and delivery is priced per kilometre.
    cacheRows = [
      {
        buyerProfileId: BUYER,
        warehouseId: WAREHOUSE,
        distanceKm: '8',
        source: DistanceSource.HAVERSINE,
        computedAt: new Date(Date.now() - 60 * 60_000),
      },
    ];
    service = build('test-key');

    const result = await service.upgradeProvisionalDistances();

    expect(result.attempted).toBe(1);
    expect(result.upgraded).toBe(1);
    expect(cacheRows[0].source).toBe(DistanceSource.GOOGLE);
    expect(Number(cacheRows[0].distanceKm)).toBe(12.4);
  });

  it('leaves a final Google row alone — it is never re-billed', async () => {
    cacheRows = [
      {
        buyerProfileId: BUYER,
        warehouseId: WAREHOUSE,
        distanceKm: '12.4',
        source: DistanceSource.GOOGLE,
        computedAt: new Date(Date.now() - 999 * 60_000),
      },
    ];
    cacheRepo.find = jest.fn(async (opts: any) => {
      // The sweep filters on provisional sources; a GOOGLE row must not match.
      const wanted = opts?.where?.source?._value ?? [];
      return cacheRows.filter((r) => wanted.includes?.(r.source) ?? false);
    });
    service = build('test-key');

    const result = await service.upgradeProvisionalDistances();

    expect(result.attempted).toBe(0);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('does nothing (and spends nothing) when no API key is configured', async () => {
    service = build(undefined);

    const ranked = await service.rankWarehouses({
      buyerProfileId: BUYER,
      provinceId: 'p1',
    });
    const upgrade = await service.upgradeProvisionalDistances();

    expect(http.get).not.toHaveBeenCalled();
    expect(ranked[0].source).toBe(DistanceSource.HAVERSINE);
    expect(upgrade).toEqual({ attempted: 0, upgraded: 0 });
  });

  it('keeps one unroutable pair from spoiling the rest of the batch', async () => {
    warehouseRepo.query = jest.fn(async (sql: string) =>
      sql.includes('ST_Y')
        ? [{ lat: 33.5, lng: 36.3 }]
        : [
            { warehouse_id: 'a', distance_km: '3' },
            { warehouse_id: 'b', distance_km: '5' },
          ],
    );
    warehouseRepo.find = jest.fn(async () => [
      { id: 'a', latitude: '1', longitude: '1' },
      { id: 'b', latitude: '2', longitude: '2' },
    ]);
    http.get = jest.fn(() =>
      of({
        data: {
          status: 'OK',
          rows: [
            {
              elements: [
                { status: 'OK', distance: { value: 4000 } },
                { status: 'ZERO_RESULTS' },
              ],
            },
          ],
        },
      }),
    );

    service = build('test-key');
    const ranked = await service.rankWarehouses({
      buyerProfileId: BUYER,
      provinceId: 'p1',
    });

    const a = ranked.find((r) => r.warehouseId === 'a');
    const b = ranked.find((r) => r.warehouseId === 'b');
    expect(a?.source).toBe(DistanceSource.GOOGLE);
    expect(a?.distanceKm).toBe(4);
    // The unroutable one keeps its estimate, and stays provisional so the
    // sweep will try it again.
    expect(b?.source).toBe(DistanceSource.HAVERSINE);
    expect(b?.distanceKm).toBe(5);
  });

  it('treats a rejected request as a failure, not as a distance', async () => {
    http.get = jest.fn(() =>
      of({ data: { status: 'REQUEST_DENIED', error_message: 'bad key' } }),
    );
    service = build('test-key');

    const ranked = await service.rankWarehouses({
      buyerProfileId: BUYER,
      provinceId: 'p1',
    });

    expect(ranked[0].source).toBe(DistanceSource.HAVERSINE);
  });
});
