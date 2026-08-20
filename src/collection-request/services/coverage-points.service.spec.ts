import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CoveragePoint } from '../entities/coverage-point.entity';
import { DriverCoverageAssignment } from '../entities/driver-coverage-assignment.entity';
import { CoveragePointsService } from './coverage-points.service';
import { CollectionCoveragePointNotFoundException } from '../exceptions/collection-request.exceptions';

describe('CoveragePointsService', () => {
  function makePoint(overrides: Partial<CoveragePoint> = {}): CoveragePoint {
    return {
      id: 'cp-1',
      name: 'Cairo Market',
      pointType: 'MARKET',
      lat: '33.5',
      lng: '36.2',
      radiusM: 1000,
      priority: 5,
      isActive: true,
      createdAt: new Date('2026-08-01T08:00:00Z'),
      updatedAt: new Date('2026-08-01T08:00:00Z'),
      ...overrides,
    } as CoveragePoint;
  }

  const mocks = () => {
    const pointRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((p: Partial<CoveragePoint>) => p),
      save: jest.fn((p: CoveragePoint) => Promise.resolve({ id: 'cp-1', ...p })),
    };
    const assignmentRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    return { pointRepo, assignmentRepo };
  };

  async function makeService(m = mocks()): Promise<CoveragePointsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CoveragePointsService,
        { provide: getRepositoryToken(CoveragePoint), useValue: m.pointRepo },
        {
          provide: getRepositoryToken(DriverCoverageAssignment),
          useValue: m.assignmentRepo,
        },
      ],
    }).compile();
    return moduleRef.get(CoveragePointsService);
  }

  afterEach(() => jest.clearAllMocks());

  it('lists points with their current parked-driver counts', async () => {
    const m = mocks();
    m.pointRepo.find.mockResolvedValue([
      makePoint({ id: 'cp-1' }),
      makePoint({ id: 'cp-2', name: 'Damascus Hospital', pointType: 'HOSPITAL' }),
    ]);
    m.assignmentRepo.find.mockResolvedValue([
      { coveragePointId: 'cp-1' },
      { coveragePointId: 'cp-1' },
      { coveragePointId: 'cp-2' },
    ] as any);

    const service = await makeService(m);
    const result = await service.list();

    expect(result).toEqual([
      expect.objectContaining({ id: 'cp-1', parked_drivers: 2 }),
      expect.objectContaining({ id: 'cp-2', parked_drivers: 1 }),
    ]);
  });

  it('creates a point with defaults when optional fields are missing', async () => {
    const m = mocks();
    const service = await makeService(m);

    await service.create({ name: 'School Yard', lat: 33.5, lng: 36.2 });

    expect(m.pointRepo.create).toHaveBeenCalledWith({
      name: 'School Yard',
      pointType: 'GENERAL',
      lat: '33.5',
      lng: '36.2',
      radiusM: 1000,
      priority: 0,
    });
  });

  it('updates only the provided fields and keeps the rest', async () => {
    const m = mocks();
    const point = makePoint();
    m.pointRepo.findOne.mockResolvedValue(point);
    m.pointRepo.save.mockImplementation((p: CoveragePoint) => Promise.resolve(p));
    const service = await makeService(m);

    const result = await service.update('cp-1', { priority: 9, is_active: false });

    expect(point.priority).toBe(9);
    expect(point.isActive).toBe(false);
    expect(point.name).toBe('Cairo Market');
    expect(result).toEqual(expect.objectContaining({ priority: 9, is_active: false }));
  });

  it('soft-removes a point instead of deleting the row', async () => {
    const m = mocks();
    const point = makePoint();
    m.pointRepo.findOne.mockResolvedValue(point);
    const service = await makeService(m);

    await service.remove('cp-1');

    expect(point.isActive).toBe(false);
    expect(m.pointRepo.save).toHaveBeenCalledWith(point);
  });

  it('throws when the point does not exist', async () => {
    const m = mocks();
    const service = await makeService(m);

    await expect(service.update('cp-9', { name: 'X' })).rejects.toBeInstanceOf(
      CollectionCoveragePointNotFoundException,
    );
    await expect(service.remove('cp-9')).rejects.toBeInstanceOf(
      CollectionCoveragePointNotFoundException,
    );
  });
});
