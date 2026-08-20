import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DispatchConfig } from '../entities/dispatch-config.entity';
import { CoverageRebalanceCron } from '../crons/coverage-rebalance.cron';
import { DispatchConfigController } from './dispatch-config.controller';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';

/**
 * Integration test: the real DispatchConfigController (guards overridden),
 * with a mocked row, through the ValidationPipe and the response envelope.
 */
describe('DispatchConfigController (integration)', () => {
  let app: INestApplication;
  const configRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((c: Partial<DispatchConfig>) => c),
    save: jest.fn((c: DispatchConfig) => Promise.resolve(c)),
  };
  const coverageCron = { reschedule: jest.fn().mockResolvedValue(undefined) };

  function fullRow() {
    return {
      id: 'cfg-1',
      singleton: true,
      weights: {
        proximity: 30,
        direction: 25,
        load: 20,
        vehicle: 15,
        deadline: 7,
        fairness: 3,
      },
      acceptWindowSec: 300,
      scheduledLeadMin: 60,
      routeMergeMaxMin: 30,
      routeMergeMaxKm: '3',
      institutionToleranceMin: 20,
      rebalanceMin: 30,
      isEnabled: true,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    } as DispatchConfig;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DispatchConfigController],
      providers: [
        { provide: getRepositoryToken(DispatchConfig), useValue: configRepo },
        { provide: CoverageRebalanceCron, useValue: coverageCron },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { id: 'admin1', role: 'ADMIN' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    configRepo.findOne.mockResolvedValue(fullRow());
    configRepo.save.mockImplementation((c: DispatchConfig) => Promise.resolve(c));
  });

  it('GET /admin/dispatch-config returns the mapped single row', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/dispatch-config')
      .expect(200);

    expect(res.body.result).toEqual(
      expect.objectContaining({
        accept_window_sec: 300,
        scheduled_lead_min: 60,
        route_merge_max_min: 30,
        route_merge_max_km: 3,
        institution_tolerance_min: 20,
        rebalance_min: 30,
        is_enabled: true,
      }),
    );
  });

  it('PATCH merges partial fields and reschedules the coverage cron', async () => {
    const res = await request(app.getHttpServer())
      .patch('/admin/dispatch-config')
      .send({ rebalance_min: 10, weights: { fairness: 8 } })
      .expect(200);

    expect(coverageCron.reschedule).toHaveBeenCalled();
    expect(res.body.result).toEqual(expect.objectContaining({ rebalance_min: 10 }));
    expect(res.body.result.weights).toEqual(
      expect.objectContaining({ fairness: 8, proximity: 30 }),
    );
  });

  it('rejects an out-of-range rebalance_min through the ValidationPipe', async () => {
    const res = await request(app.getHttpServer())
      .patch('/admin/dispatch-config')
      .send({ rebalance_min: 0 })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(coverageCron.reschedule).not.toHaveBeenCalled();
  });
});