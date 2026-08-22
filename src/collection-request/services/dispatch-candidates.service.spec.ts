import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { DispatchCandidatesService } from './dispatch-candidates.service';
import { CollectionRequest } from '../entities/collection-request.entity';
import { DriverCoverageAssignment } from '../entities/driver-coverage-assignment.entity';
import { CollectionRequestType } from '../enums/collection-request-type.enum';

/** A query-builder mock: every chained call returns the builder, and the
 * terminating getMany/getRawMany resolve the injected rows. */
function builderOf(rows: unknown[]) {
  const build: any = {
    innerJoinAndSelect: jest.fn(() => build),
    innerJoin: jest.fn(() => build),
    select: jest.fn(() => build),
    addSelect: jest.fn(() => build),
    where: jest.fn(() => build),
    andWhere: jest.fn(() => build),
    groupBy: jest.fn(() => build),
    orderBy: jest.fn(() => build),
    getMany: jest.fn().mockResolvedValue(rows),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  return build;
}

describe('DispatchCandidatesService', () => {
  // Fixed "now" so the shift-coverage math is deterministic — constructed in
  // LOCAL time so getHours() in the service matches regardless of timezone.
  beforeAll(() =>
    jest.useFakeTimers({ now: new Date(2026, 7, 17, 14, 0, 0) }),
  );

  const config = {
    weights: { proximity: 30, direction: 25, load: 20, vehicle: 15, deadline: 7, fairness: 3 },
    acceptWindowSec: 300,
    scheduledLeadMin: 60,
    isEnabled: true,
  } as any;

  function makeProfile(overrides: Partial<any> = {}) {
    return {
      id: 'prof-1',
      account: { id: 'acc-1', accountStatus: 'ACTIVE' },
      shift: { startTime: '08:00', endTime: '16:00', isActive: true },
      assignment: { truck: { id: 'truck-1', maxPayloadKg: 2000, status: 'ACTIVE' } },
      ...overrides,
    };
  }

  async function makeService(repoMocks: Record<string, any>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DispatchCandidatesService,
        { provide: getRepositoryToken(CollectorProfile), useValue: repoMocks.profileRepo },
        { provide: getRepositoryToken(CollectionRequest), useValue: repoMocks.requestRepo },
        { provide: getRepositoryToken(DriverCoverageAssignment), useValue: repoMocks.coverageRepo },
      ],
    }).compile();
    return moduleRef.get(DispatchCandidatesService);
  }

  const baseRepos = {
    profileRepo: { createQueryBuilder: jest.fn() },
    requestRepo: { createQueryBuilder: jest.fn() },
    coverageRepo: { createQueryBuilder: jest.fn() },
  };

  afterEach(() => jest.clearAllMocks());

  it('keeps drivers whose shift covers now (including a 24h shift) and drops the rest', async () => {
    const repos = {
      profileRepo: {
        createQueryBuilder: jest
          .fn()
          .mockReturnValue(
            builderOf([
              makeProfile({ id: 'day', account: { id: 'acc-day' }, shift: { startTime: '13:00', endTime: '15:00' } }),
              makeProfile({ id: 'night', account: { id: 'acc-night' }, shift: { startTime: '22:00', endTime: '06:00' } }),
              makeProfile({ id: 'round', account: { id: 'acc-round' }, shift: { startTime: '00:00', endTime: '00:00' } }),
              makeProfile({ id: 'off', account: { id: 'acc-off' }, shift: { startTime: '00:00', endTime: '08:00' } }),
            ]),
          ),
      },
      requestRepo: {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(builderOf([]))
          .mockReturnValueOnce(builderOf([]))
          .mockReturnValueOnce(builderOf([])),
      },
      coverageRepo: { createQueryBuilder: jest.fn().mockReturnValue(builderOf([])) },
    };

    const service = await makeService(repos);
    const result = await service.findEligible(
      {
        id: 'req-1',
        type: CollectionRequestType.IMMEDIATE,
        estimatedWeightKg: '10',
      } as CollectionRequest,
      config,
    );

    // 14:00 local: 13:00-15:00 and the 24h shift cover it; 22:00-06:00 and
    // 00:00-08:00 do not.
    expect(result.map((c) => c.driverId).sort()).toEqual(['day', 'round']);
  });

  it('excludes busy drivers (mid-pickup) and gates on remaining payload capacity', async () => {
    const repos = {
      profileRepo: {
        createQueryBuilder: jest
          .fn()
          .mockReturnValue(
            builderOf([
              makeProfile({
                id: 'free-ok',
                account: { id: 'acc-free' },
                assignment: { truck: { id: 't1', maxPayloadKg: 2000, status: 'ACTIVE' } },
              }),
              makeProfile({
                id: 'busy',
                account: { id: 'acc-busy' },
                assignment: { truck: { id: 't2', maxPayloadKg: 2000, status: 'ACTIVE' } },
              }),
              makeProfile({
                id: 'no-room',
                account: { id: 'acc-room' },
                assignment: { truck: { id: 't3', maxPayloadKg: 100, status: 'ACTIVE' } },
              }),
            ]),
          ),
      },
      requestRepo: {
        // Call order inside findEligible: taskCounts (await), then completedToday
        // (Promise.all interleave), then the busy query.
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(
            builderOf([
              { driverId: 'busy', taskCount: '0', taskWeight: '0' },
              { driverId: 'no-room', taskCount: '1', taskWeight: '95' },
            ]),
          )
          .mockReturnValueOnce(builderOf([]))
          .mockReturnValueOnce(builderOf([{ driverId: 'busy' }])),
      },
      coverageRepo: { createQueryBuilder: jest.fn().mockReturnValue(builderOf([])) },
    };

    const service = await makeService(repos);
    const result = await service.findEligible(
      {
        id: 'req-1',
        type: CollectionRequestType.IMMEDIATE,
        estimatedWeightKg: '10',
      } as CollectionRequest,
      config,
    );

    expect(result.map((c) => c.driverId)).toEqual(['free-ok']);
    expect(result[0]).toMatchObject({
      accountId: 'acc-free',
      activeTasks: 0,
      activeWeightKg: 0,
      completedToday: 0,
      maxPayloadKg: 2000,
    });
  });

  it('collects the workload context (load, weight, completed today) and coverage fallbacks', async () => {
    const repos = {
      profileRepo: {
        createQueryBuilder: jest
          .fn()
          .mockReturnValue(
            builderOf([
              makeProfile({
                id: 'loaded',
                account: { id: 'acc-loaded' },
                assignment: { truck: { id: 't1', maxPayloadKg: 1000, status: 'ACTIVE' } },
              }),
            ]),
          ),
      },
      requestRepo: {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(builderOf([{ driverId: 'loaded', taskCount: '3', taskWeight: '150' }]))
          .mockReturnValueOnce(builderOf([{ driverId: 'loaded', doneCount: '5' }]))
          .mockReturnValueOnce(builderOf([])),
      },
      coverageRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(
          builderOf([
            {
              driverId: 'loaded',
              isActive: true,
              coveragePoint: { lat: 33.49, lng: 36.2, isActive: true },
            },
          ]),
        ),
      },
    };

    const service = await makeService(repos);
    const result = await service.findEligible(
      {
        id: 'req-1',
        type: CollectionRequestType.IMMEDIATE,
        estimatedWeightKg: '50',
      } as CollectionRequest,
      config,
    );

    expect(result[0]).toMatchObject({
      activeTasks: 3,
      activeWeightKg: 150,
      completedToday: 5,
      maxPayloadKg: 1000,
      fallbackLocation: { lat: 33.49, lng: 36.2 },
    });
    // Validate against the completed count? No - the completed/task joins hit
    // the mock rows above; the capacity gate uses 1000 - 150 >= 50.
    expect(result[0].passesCapacity).toBe(true);
  });

  it('returns an empty pool when the profiles query finds nobody', async () => {
    const repos = {
      ...baseRepos,
      profileRepo: { createQueryBuilder: jest.fn().mockReturnValue(builderOf([])) },
    };

    const service = await makeService(repos);
    const result = await service.findEligible(
      { id: 'req-1', type: CollectionRequestType.IMMEDIATE, estimatedWeightKg: '10' } as CollectionRequest,
      config,
    );

    expect(result).toEqual([]);
  });
});