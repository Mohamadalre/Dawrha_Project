import { Controller, Get, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as path from 'path';
import request from 'supertest';
import { AcceptLanguageResolver, HeaderResolver, I18nModule } from 'nestjs-i18n';
import { TransformInterceptor } from '@src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from '@src/common/filters/all-exceptions.filter';
import {
  DuplicateResourceException,
  ForbiddenActionException,
} from '@src/common/exceptions/app.exception';

/**
 * Integration/E2E test of the unified response contract — real HTTP through the
 * real TransformInterceptor + AllExceptionsFilter + i18n, no database needed.
 *
 * Contract under test (every endpoint in the API):
 *   success: { success:true,  message, data, statusCode, timestamp }
 *   error:   { success:false, message, [errorCode], data:null, statusCode, timestamp }
 * with `message` translated to the request language (x-lang header).
 */
@Controller('probe')
class ProbeController {
  /** Mirrors the app-wide `{ message, result }` service convention. */
  @Get('ok')
  ok() {
    return { message: 'Products fetched successfully', result: { items: [1, 2] } };
  }

  /** Message-only responses must yield data:null (no message leakage into data). */
  @Get('bare')
  bare() {
    return { message: 'Logout successfully' };
  }

  /** Custom domain exception with a machine-readable errorCode. */
  @Get('conflict')
  conflict() {
    throw new DuplicateResourceException('Unit already exists', 'UNIT_ALREADY_EXISTS');
  }

  @Get('forbidden')
  forbidden() {
    throw new ForbiddenActionException(
      'Only factories, free facilities and institutions have onboarding materials',
      'MATERIALS_NOT_APPLICABLE',
    );
  }

  /** Unexpected crashes must still come back in the unified envelope. */
  @Get('crash')
  crash() {
    throw new Error('kaboom');
  }
}

describe('Unified response envelope (integration/e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          fallbackLanguage: 'en',
          loaderOptions: { path: path.join(__dirname, '../src/i18n/') },
          resolvers: [new HeaderResolver(['x-lang', 'lang']), AcceptLanguageResolver],
        }),
      ],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('success: wraps { message, result } into { success:true, message, data }', async () => {
    const res = await request(app.getHttpServer()).get('/probe/ok').expect(200);

    expect(res.body).toMatchObject({
      success: true,
      message: 'Products fetched successfully',
      data: { items: [1, 2] },
      statusCode: 200,
    });
    expect(res.body.timestamp).toBeDefined();
    // Guard against the historical double-wrap bug: data must never nest
    // another `data`/`message` produced by the service convention.
    expect(res.body.data.data).toBeUndefined();
    expect(res.body.data.message).toBeUndefined();
  });

  it('translates the success message to Arabic via the x-lang header', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/ok')
      .set('x-lang', 'ar')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('تم جلب المنتجات بنجاح');
    expect(res.body.data).toEqual({ items: [1, 2] });
  });

  it('message-only responses produce data:null (message never leaks into data)', async () => {
    const res = await request(app.getHttpServer()).get('/probe/bare').expect(200);

    expect(res.body.message).toBe('Logout successfully');
    expect(res.body.data).toBeNull();
  });

  it('domain error: { success:false, errorCode, data:null } with Arabic translation', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/conflict')
      .set('x-lang', 'ar')
      .expect(409);

    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'UNIT_ALREADY_EXISTS',
      data: null,
      statusCode: 409,
    });
    expect(res.body.message).toBe('وحدة القياس موجودة مسبقاً');
  });

  it('forbidden domain error keeps the envelope and translates', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/forbidden')
      .set('x-lang', 'ar')
      .expect(403);

    expect(res.body).toMatchObject({
      success: false,
      errorCode: 'MATERIALS_NOT_APPLICABLE',
      data: null,
    });
    expect(res.body.message).toBe('هذه الخدمة متاحة فقط للمعامل والجهات الحرة والمؤسسات');
  });

  it('unexpected crash → 500 in the same envelope (no stack leakage)', async () => {
    const res = await request(app.getHttpServer()).get('/probe/crash').expect(500);

    expect(res.body).toMatchObject({ success: false, data: null, statusCode: 500 });
    expect(JSON.stringify(res.body)).not.toContain('at ProbeController');
  });
});
