import {
  Body,
  Controller,
  INestApplication,
  Post,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as path from 'path';
import request from 'supertest';
import { AcceptLanguageResolver, HeaderResolver, I18nModule } from 'nestjs-i18n';
import { TransformInterceptor } from '@src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from '@src/common/filters/all-exceptions.filter';
import {
  EmailRegisteredWithGoogleException,
  SocialLoginRequiredException,
} from '@src/auth/exceptions/auth.exceptions';

/**
 * What a user is told when they reach for the wrong sign-in method.
 *
 * An account created through Google has no stored password. The password form
 * used to hand that `null` straight to argon2, which threw "pchstr must be a
 * non-empty string" — surfacing as a **500 with no errorCode**, for what is an
 * ordinary and entirely foreseeable mistake. The user learned nothing they could
 * act on, and retyped a password that had never existed.
 *
 * These tests pin the whole answer, not just the status: the code a client
 * branches on, and the sentence in BOTH languages — because a message that
 * exists only in English is, to an Arabic user, the same dead end in nicer
 * clothing.
 *
 * The exceptions are raised from a probe controller rather than reached through
 * AuthService: what is under test here is the SHAPE of the answer — status,
 * code, translated message — and routing that through a database and Redis
 * would test those instead. The decision to raise them is covered separately in
 * `auth.service.spec.ts`.
 */
@Controller('probe/auth')
class AuthProbeController {
  /** Password login attempted on an account created through Google. */
  @Post('login')
  login(@Body() _body: unknown) {
    throw new SocialLoginRequiredException();
  }

  /** Local registration attempted on an address that already signs in with Google. */
  @Post('register')
  register(@Body() _body: unknown) {
    throw new EmailRegisteredWithGoogleException();
  }
}

describe('Google-account sign-in guidance (integration/e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          fallbackLanguage: 'en',
          loaderOptions: {
            path: path.join(__dirname, '..', 'src', 'i18n'),
            watch: false,
          },
          resolvers: [
            new HeaderResolver(['x-lang', 'lang']),
            AcceptLanguageResolver,
          ],
        }),
      ],
      controllers: [AuthProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const ENGLISH_LOGIN =
    'This email is registered with Google. Please sign in with Google instead.';
  const ENGLISH_REGISTER =
    'This email is already registered with Google. Please sign in with Google instead.';

  describe('password login on a Google account', () => {
    it('answers 400, not 500 — this is a user mistake, not a server fault', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/probe/auth/login')
        .send({ email: 'g@e.com', password: 'anything' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(400);
    });

    it('carries a machine-readable code the client can branch on', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/probe/auth/login')
        .send({})
        .expect(400);

      // Without this the app can only match on prose, which breaks the moment
      // the wording or the language changes.
      expect(res.body.errorCode).toBe('SOCIAL_LOGIN_REQUIRED');
    });

    it('names Google in English', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/probe/auth/login')
        .set('x-lang', 'en')
        .send({})
        .expect(400);

      expect(res.body.message).toBe(ENGLISH_LOGIN);
    });

    it('names Google in Arabic', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/probe/auth/login')
        .set('x-lang', 'ar')
        .send({})
        .expect(400);

      expect(res.body.message).not.toBe(ENGLISH_LOGIN);
      expect(res.body.message).toMatch(/[؀-ۿ]/);
      // The one word that must survive translation: it names the way in.
      expect(res.body.message).toContain('Google');
    });
  });

  describe('local registration on a Google address', () => {
    it('answers 400 with its own code, distinct from a plain duplicate email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/probe/auth/register')
        .send({ email: 'g@e.com' })
        .expect(400);

      // Distinct from EMAIL_ALREADY_EXISTS on purpose: "this address is taken"
      // and "you already have an account, through Google" call for different
      // things from the user.
      expect(res.body.errorCode).toBe('EMAIL_REGISTERED_WITH_GOOGLE');
      expect(res.body.success).toBe(false);
    });

    it('tells the user in English that the account was created with Google', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/probe/auth/register')
        .set('x-lang', 'en')
        .send({})
        .expect(400);

      expect(res.body.message).toBe(ENGLISH_REGISTER);
    });

    it('tells the user in Arabic that the account was created with Google', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/probe/auth/register')
        .set('x-lang', 'ar')
        .send({})
        .expect(400);

      expect(res.body.message).toMatch(/[؀-ۿ]/);
      expect(res.body.message).toContain('Google');
    });
  });

  it('keeps the unified envelope — data null, never a leaked payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe/auth/login')
      .set('x-lang', 'ar')
      .send({})
      .expect(400);

    expect(res.body).toMatchObject({ success: false, data: null, statusCode: 400 });
    expect(typeof res.body.timestamp).toBe('string');
  });
});
