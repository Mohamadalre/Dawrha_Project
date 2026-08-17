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
import { DeliveryRateController } from '@src/warehouse/delivery-rate.controller';
import { DeliveryRateService } from '@src/warehouse/providers/delivery-rate.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';

/**
 * The delivery-rate ENDPOINTS after `min_charge` was removed — asserted at the
 * HTTP boundary, through the real pipeline (validation pipe + interceptor).
 *
 * The whole point of removing the option is the WIRE CONTRACT: a unit test on
 * the service cannot see that the DTO no longer accepts `min_charge`, and that
 * the global `forbidNonWhitelisted` pipe now REJECTS it. That only shows up when
 * a real request carrying the old field is sent through the real pipe — which is
 * exactly what these tests do.
 */
describe('Delivery rate — min_charge removed (e2e)', () => {
  let app: INestApplication;
  const calls: { set: any[]; update: any[]; quote: any[] } = { set: [], update: [], quote: [] };

  // A stub standing in for the data layer: the endpoints are what we test, not
  // the repository. `quote` returns exactly what the real service now computes —
  // base fee + distance × rate, with NO floor.
  const serviceStub: Partial<DeliveryRateService> = {
    view: async () => ({ is_configured: true, current: { rate_per_km: 0.5, base_fee: 2 } }) as any,
    set: async (dto: any, userId: string) => {
      calls.set.push({ dto, userId });
      return { message: 'Delivery rate updated successfully', result: dto } as any;
    },
    update: async (id: string, dto: any, userId: string) => {
      calls.update.push({ id, dto, userId });
      return { message: 'Delivery rate updated successfully', result: dto } as any;
    },
    quote: async (distanceKm: number) => {
      calls.quote.push(distanceKm);
      const cost = 2 + distanceKm * 0.5; // base + dist × rate, no floor
      return { distance_km: distanceKm, base_fee: 2, rate_per_km: 0.5, cost, currency: 'JOD' } as any;
    },
  };

  // Guards bypassed; the JWT guard seeds a user so @CurrentUser() has an id.
  const passUser = {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = { id: 'admin-1' };
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
      controllers: [DeliveryRateController],
      providers: [
        { provide: DeliveryRateService, useValue: serviceStub },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(passUser)
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    // The SAME pipe as production — whitelist + reject unknown properties.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterEach(() => {
    calls.set = [];
    calls.update = [];
    calls.quote = [];
  });

  afterAll(async () => {
    await app?.close();
  });

  const base = '/api/v1/admin/delivery-rate';

  it('REJECTS a create that still carries min_charge (option is gone)', async () => {
    const res = await request(app.getHttpServer())
      .post(base)
      .send({ rate_per_km: 0.5, base_fee: 2, min_charge: 5 })
      .expect(400);

    // The pipe names the offending field; the service is never reached.
    expect(JSON.stringify(res.body)).toMatch(/min_charge/);
    expect(calls.set).toHaveLength(0);
  });

  it('accepts a create WITHOUT min_charge and forwards a clean dto', async () => {
    await request(app.getHttpServer())
      .post(base)
      .send({ rate_per_km: 0.5, base_fee: 2 })
      .expect(201);

    expect(calls.set).toHaveLength(1);
    expect(calls.set[0].dto).not.toHaveProperty('min_charge');
    expect(calls.set[0].userId).toBe('admin-1');
  });

  it('REJECTS an update that carries min_charge', async () => {
    await request(app.getHttpServer())
      .patch(`${base}/11111111-1111-4111-8111-111111111111`)
      .send({ rate_per_km: 0.9, min_charge: 3 })
      .expect(400);

    expect(calls.update).toHaveLength(0);
  });

  it('quotes base + distance × rate with NO floor, and no min_charge key', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/quote`)
      .query({ distance_km: '1' })
      .expect(200);

    // 2 + 1 × 0.5 = 2.5 — a short trip is NOT lifted to any minimum.
    expect(res.body.data.cost).toBe(2.5);
    expect(res.body.data).not.toHaveProperty('min_charge');
  });

  it('rejects a negative base fee', async () => {
    await request(app.getHttpServer())
      .post(base)
      .send({ rate_per_km: 0.5, base_fee: -1 })
      .expect(400);
  });
});
