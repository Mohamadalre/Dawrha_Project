import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionRouteStatus } from '../enums/collection-route-status.enum';
import { CollectionRequestType } from '../enums/collection-request-type.enum';
import { CollectionReportsService } from './collection-reports.service';

describe('CollectionReportsService', () => {
  function makeQb(overrides: Record<string, unknown> = {}) {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(null),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getMany: jest.fn().mockResolvedValue([]),
      ...overrides,
    };
    return qb;
  }

  function makeRequest(overrides: Partial<CollectionRequest> = {}): CollectionRequest {
    return {
      id: 'req-1',
      requestNumber: 'CR-202608-00001',
      status: CollectionRequestStatus.QUEUED,
      type: CollectionRequestType.IMMEDIATE,
      accountId: 'acc-1',
      routeId: null,
      route: null,
      scheduledAt: null,
      estimatedWeightKg: '10',
      actualWeightKg: null,
      estimatedGrandTotal: '250.00',
      actualGrandTotal: null,
      createdAt: new Date('2026-08-10T09:00:00Z'),
      lines: [],
      ...overrides,
    } as CollectionRequest;
  }

  function makeRoute(overrides: Partial<CollectionRoute> = {}): CollectionRoute {
    return {
      id: 'rt-1',
      routeNumber: 'CR-20260810-0001',
      status: CollectionRouteStatus.IN_PROGRESS,
      driverId: 'dA',
      startedAt: null,
      completedAt: null,
      createdAt: new Date('2026-08-10T09:30:00Z'),
      requests: [],
      ...overrides,
    } as CollectionRoute;
  }

  const mocks = () => {
    const requestQb = makeQb();
    const routeQb = makeQb();
    const requestRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(requestQb),
    };
    const routeRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(routeQb),
    };
    return { requestRepo, routeRepo, requestQb, routeQb };
  };

  async function makeService(m = mocks()): Promise<CollectionReportsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CollectionReportsService,
        { provide: getRepositoryToken(CollectionRequest), useValue: m.requestRepo },
        { provide: getRepositoryToken(CollectionRoute), useValue: m.routeRepo },
      ],
    }).compile();
    return moduleRef.get(CollectionReportsService);
  }

  afterEach(() => jest.clearAllMocks());

  describe('daily', () => {
    it('counts requests and routes by status, weighing only completed stops', async () => {
      const m = mocks();
      m.requestQb.getRawMany.mockResolvedValue([
        {
          status: CollectionRequestStatus.COMPLETED,
          count: '2',
          weightKg: '30.5',
          value: '812.75',
        },
        { status: CollectionRequestStatus.QUEUED, count: '1', weightKg: '0', value: '0' },
      ]);
      m.routeQb.getRawMany.mockResolvedValue([
        { status: CollectionRouteStatus.IN_PROGRESS, count: '1' },
      ]);

      const service = await makeService(m);
      const result = await service.daily('2026-08-10');

      expect(result.date).toBe('2026-08-10');
      expect(result.requests.total).toBe(3);
      expect(result.requests.by_status).toEqual({
        [CollectionRequestStatus.COMPLETED]: '2',
        [CollectionRequestStatus.QUEUED]: '1',
      });
      expect(result.requests.collected_weight_kg).toBe(30.5);
      expect(result.requests.paid_out_value).toBe(812.75);
      expect(result.routes.by_status).toEqual({
        [CollectionRouteStatus.IN_PROGRESS]: '1',
      });
      expect(m.requestQb.where).toHaveBeenCalledWith(
        expect.stringContaining('r.createdAt >= :from'),
        expect.objectContaining({ from: expect.any(Date) }),
      );
    });

    it('falls back to today when the date is invalid', async () => {
      const m = mocks();
      const service = await makeService(m);
      const result = await service.daily('not-a-date');
      expect(result.date).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  describe('requests', () => {
    it('returns the mapped ledger with pagination and window totals', async () => {
      const m = mocks();
      const request = makeRequest({
        routeId: 'rt-1',
        route: { driverId: 'dA' } as any,
        actualWeightKg: '42',
        actualGrandTotal: '999.50',
      });
      m.requestQb.getManyAndCount.mockResolvedValue([[request], 1]);
      m.requestQb.getRawOne.mockResolvedValue({ total: '1', weightKg: '42', value: '999.50' });

      const service = await makeService(m);
      const result = await service.requests({ page: 1, limit: 20 });

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0]).toEqual(
        expect.objectContaining({
          request_id: 'req-1',
          driver_id: 'dA',
          actual_weight_kg: 42,
          actual_grand_total: 999.5,
        }),
      );
      expect(result.totals).toEqual({
        total_requests: 1,
        collected_weight_kg: 42,
        collected_value: 999.5,
      });
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, pages: 1 });
    });

    it('applies status, type and driver filters to the query', async () => {
      const m = mocks();
      m.requestQb.getManyAndCount.mockResolvedValue([[], 0]);
      m.requestQb.getRawOne.mockResolvedValue({ total: '0', weightKg: '0', value: '0' });

      const service = await makeService(m);
      await service.requests({
        status: CollectionRequestStatus.ASSIGNED,
        type: CollectionRequestType.SCHEDULED,
        driverId: 'dA',
        page: 2,
        limit: 5,
      });

      expect(m.requestQb.andWhere).toHaveBeenCalledWith('r.status = :status', {
        status: CollectionRequestStatus.ASSIGNED,
      });
      expect(m.requestQb.andWhere).toHaveBeenCalledWith('route.driverId = :driverId', {
        driverId: 'dA',
      });
      expect(m.requestQb.skip).toHaveBeenCalledWith(5);
      expect(m.requestQb.take).toHaveBeenCalledWith(5);
    });
  });

  describe('routes', () => {
    it('counts only completed stops and falls back to estimates for value', async () => {
      const m = mocks();
      m.routeQb.getMany.mockResolvedValue([
        makeRoute({
          requests: [
            makeRequest({
              id: 'req-1',
              status: CollectionRequestStatus.COMPLETED,
              actualWeightKg: '20',
              actualGrandTotal: '500',
            }),
            makeRequest({
              id: 'req-2',
              status: CollectionRequestStatus.COMPLETED,
              actualWeightKg: '5.5',
              actualGrandTotal: null,
              estimatedGrandTotal: '120.00',
            }),
            makeRequest({
              id: 'req-3',
              status: CollectionRequestStatus.ASSIGNED,
            }),
          ],
        }),
      ]);

      const service = await makeService(m);
      const result = await service.routes({});

      expect(result.routes).toHaveLength(1);
      expect(result.routes[0]).toEqual(
        expect.objectContaining({
          stops_total: 3,
          stops_completed: 2,
          collected_weight_kg: 25.5,
          collected_value: 620,
        }),
      );
      expect(result.totals).toEqual({
        routes: 1,
        collected_weight_kg: 25.5,
        collected_value: 620,
      });
    });

    it('filters routes by window and driver', async () => {
      const m = mocks();
      const service = await makeService(m);
      await service.routes({ from: '2026-08-01', to: '2026-08-10', driverId: 'dA' });

      expect(m.routeQb.andWhere).toHaveBeenCalledWith('rt.driverId = :driverId', {
        driverId: 'dA',
      });
      expect(m.routeQb.andWhere).toHaveBeenCalledWith(
        'rt.createdAt >= :from',
        expect.any(Object),
      );
    });
  });
});
