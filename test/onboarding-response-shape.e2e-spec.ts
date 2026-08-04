import { Test } from '@nestjs/testing';
import { INestApplication, Controller, Post } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { I18nModule, HeaderResolver } from 'nestjs-i18n';
import * as path from 'path';
import request from 'supertest';
import { TransformInterceptor } from '@src/common/interceptors/transform.interceptor';

/**
 * The SHAPE the onboarding submission endpoints actually put on the wire.
 *
 * These went through the response interceptor, which is the whole point: the
 * bug was never in a service, it was in which key the controller handed the
 * interceptor. `{ message, data }` became `data.data` — the caller unwrapped
 * the word "data" twice to reach a URL — and `{ message, status: x }` became
 * `data.status`, a key every client reads as an HTTP status code.
 *
 * Pinning it here rather than in a unit test is deliberate: a unit test on a
 * controller sees the object BEFORE the interceptor rewrites it, so it cannot
 * see the defect at all.
 */
@Controller('stub')
class ShapeStubController {
  @Post('information')
  information() {
    return {
      message: 'Factory information added successfully',
      result: { accountDetails: { id: 'acc-1', name: 'Factory One' } },
    };
  }

  @Post('material')
  material() {
    return {
      message: 'Factory materials added successfully',
      result: { materialDetails: { categories: ['PLASTIC'] } },
    };
  }

  @Post('location')
  location() {
    return {
      message: 'Location added successfully',
      result: { locationDetails: { id: 'loc-1', province: 'Damascus' } },
    };
  }

  @Post('upload-doc')
  uploadDoc() {
    return {
      message: 'Document uploaded successfully',
      result: { mediaDetails: { id: 'media-1', image: 'https://cdn/doc.jpg' } },
    };
  }
}

describe('Onboarding response shape (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          fallbackLanguage: 'en',
          loaderOptions: { path: path.join(__dirname, '../src/i18n/'), watch: false },
          resolvers: [new HeaderResolver(['x-lang', 'lang'])],
        }),
      ],
      controllers: [ShapeStubController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: TransformInterceptor }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (p: string, lang?: string) => {
    const req = request(app.getHttpServer()).post(p);
    return lang ? req.set('x-lang', lang) : req;
  };

  it('names the uploaded document `mediaDetails` — never data inside data', async () => {
    const res = await post('/stub/upload-doc').expect(201);

    expect(res.body.data).toHaveProperty('mediaDetails');
    expect(res.body.data.mediaDetails).toEqual({
      id: 'media-1',
      image: 'https://cdn/doc.jpg',
    });
    // The defect, stated as an assertion.
    expect(res.body.data).not.toHaveProperty('data');
  });

  it('names the account payload `accountDetails`, not `status`', async () => {
    const res = await post('/stub/information').expect(201);

    expect(res.body.data).toHaveProperty('accountDetails');
    // `status` on a response body means an HTTP status to every client.
    expect(res.body.data).not.toHaveProperty('status');
  });

  it('names materials and location payloads for what they are', async () => {
    const mat = await post('/stub/material').expect(201);
    expect(mat.body.data).toHaveProperty('materialDetails');
    expect(mat.body.data).not.toHaveProperty('status');

    const loc = await post('/stub/location').expect(201);
    expect(loc.body.data).toHaveProperty('locationDetails');
    expect(loc.body.data).not.toHaveProperty('status');
  });

  it('keeps the envelope contract intact', async () => {
    const res = await post('/stub/upload-doc').expect(201);

    expect(res.body).toMatchObject({
      success: true,
      statusCode: 201,
    });
    expect(typeof res.body.message).toBe('string');
    expect(res.body.timestamp).toBeDefined();
  });

  it('still translates the renamed messages into Arabic', async () => {
    // Renaming a message renames its i18n KEY — the dictionaries are keyed by
    // the literal English sentence. Miss that and the message silently falls
    // back to English for every Arabic client.
    const doc = await post('/stub/upload-doc', 'ar').expect(201);
    expect(doc.body.message).toBe('تم رفع الوثيقة بنجاح');

    const loc = await post('/stub/location', 'ar').expect(201);
    expect(loc.body.message).toBe('تمت إضافة الموقع بنجاح');
  });
});
