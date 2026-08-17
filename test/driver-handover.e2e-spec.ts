import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
  ExecutionContext,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { I18nModule, HeaderResolver } from 'nestjs-i18n';
import * as path from 'path';
import request from 'supertest';
import { TransformInterceptor } from '@src/common/interceptors/transform.interceptor';
import { DriverController } from '@src/truck/driver.controller';
import { HandoverService } from '@src/truck/handover.service';
import { AssignmentService } from '@src/truck/assignment.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';

/**
 * The driver pickup / dropoff ENDPOINTS after GPS was added — asserted at the
 * HTTP boundary through the real validation pipe.
 *
 * The coordinates are what tracking now persists at the session's start and end,
 * so the wire must (a) validate them (a bad latitude is a 400, not a stored lie)
 * and (b) forward BOTH halves to the service. A service unit test sees neither
 * the DTO validation nor the coordinate transform — only a real request does.
 */
describe('Driver handover with GPS (e2e)', () => {
  let app: INestApplication;
  const calls: { pickup: any[]; dropoff: any[] } = { pickup: [], dropoff: [] };

  const handoverStub: Partial<HandoverService> = {
    pickup: async (accountId: string, coords?: any) => {
      calls.pickup.push({ accountId, coords });
      return { message: 'Truck picked up successfully', handover_id: 'h1', picked_up_at: new Date() } as any;
    },
    dropoff: async (accountId: string, reason: string, coords?: any) => {
      calls.dropoff.push({ accountId, reason, coords });
      return { message: 'Truck handed back successfully', handover_id: 'h1', dropped_off_at: new Date(), late_dropoff_minutes: 0 } as any;
    },
  };
  const assignmentStub: Partial<AssignmentService> = {
    getMyAssignment: async () => ({ message: 'ok', result: null }) as any,
  };

  const passUser = {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = { id: 'driver-acc-1', role: 'COLLECTOR' };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          fallbackLanguage: 'en',
          loaderOptions: { path: path.join(__dirname, '../src/i18n/'), watch: false },
          resolvers: [new HeaderResolver(['x-lang', 'lang'])],
        }),
      ],
      controllers: [DriverController],
      providers: [
        { provide: HandoverService, useValue: handoverStub },
        { provide: AssignmentService, useValue: assignmentStub },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(passUser)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterEach(() => {
    calls.pickup = [];
    calls.dropoff = [];
  });

  afterAll(async () => {
    await app?.close();
  });

  it('forwards pickup GPS to the service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/driver/pickup')
      .send({ lat: 33.51, lng: 36.29 })
      .expect(201);

    expect(calls.pickup).toHaveLength(1);
    expect(calls.pickup[0].accountId).toBe('driver-acc-1');
    expect(calls.pickup[0].coords).toEqual({ lat: 33.51, lng: 36.29 });
  });

  it('accepts a pickup with no GPS (an app with no fix still works)', async () => {
    await request(app.getHttpServer()).post('/api/v1/driver/pickup').send({}).expect(201);
    expect(calls.pickup[0].coords).toEqual({ lat: undefined, lng: undefined });
  });

  it('REJECTS a pickup with an out-of-range latitude', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/driver/pickup')
      .send({ lat: 999, lng: 36.29 })
      .expect(400);
    expect(calls.pickup).toHaveLength(0);
  });

  it('dropoff requires a reason (400 without it) and forwards GPS with it', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/driver/dropoff')
      .send({ lat: 33.5, lng: 36.3 })
      .expect(400); // reason missing

    await request(app.getHttpServer())
      .post('/api/v1/driver/dropoff')
      .send({ reason: 'engine noise', lat: 33.5, lng: 36.3 })
      .expect(200);

    expect(calls.dropoff).toHaveLength(1);
    expect(calls.dropoff[0].reason).toBe('engine noise');
    expect(calls.dropoff[0].coords).toEqual({ lat: 33.5, lng: 36.3 });
  });

  it('REJECTS unknown properties on the handover body', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/driver/pickup')
      .send({ lat: 33.5, lng: 36.3, spoof: 'x' })
      .expect(400);
  });
});
