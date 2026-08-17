import { Test } from '@nestjs/testing';
import { INestApplication, Controller, Get, VersioningType } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import {
  AccountsStatus,
  TOKEN_HOLDING_STATUSES,
} from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { DataSource } from 'typeorm';

/**
 * Does the token an inactive applicant receives actually open only what it
 * should?
 *
 * The unit tests pin the guard's decisions; this pins the thing that made those
 * decisions reachable at all — that the guard is consulted on a route which
 * never asked for it, reading the status out of the token itself. That is the
 * whole reason issuing these tokens is safe, and it is a wiring property, so it
 * cannot be tested by constructing the guard by hand.
 *
 * No AppModule: two bare controllers standing in for "a route that forgot to
 * declare anything" (the cart, the catalogue — 210 of them) and "a route opened
 * to applicants" (the application, the re-upload).
 *
 * The guard reads the LIVE account status from the database by the token's id —
 * never from the token's own claim, so a status that changed after the token was
 * minted (blocked, approved) takes effect at once. A tiny DataSource stub stands
 * in for that lookup: each test signs a token whose id IS the status it is
 * exercising, and the stub returns an account carrying exactly that status.
 */

/** Stands in for every route that declares nothing: cart, catalogue, orders. */
@Controller('cart')
class CartStubController {
  @Get()
  list() {
    return { reached: true };
  }
}

/**
 * Stands in for the SESSION routes: logout, device language, notifications.
 *
 * Fail-closed turned these into a trap — an applicant could sign in and not
 * sign out, and the notifications telling them "approved" / "please re-upload"
 * were readable only by a status that by definition never receives them.
 */
@AccountsStatus(...TOKEN_HOLDING_STATUSES)
@Controller('session')
class SessionStubController {
  @Get('logout')
  logout() {
    return { reached: true };
  }
}

/** Stands in for the routes an applicant legitimately needs. */
@Controller('application')
class ApplicationStubController {
  @Get('submission')
  @AccountsStatus(
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.NEED_CHANGES,
    AccountStatus.REJECTED,
  )
  submission() {
    return { reached: true };
  }

  @Get('reupload')
  @AccountsStatus(AccountStatus.NEED_CHANGES)
  reupload() {
    return { reached: true };
  }
}

const SECRET = 'test-access-secret-for-account-status-scope';

describe('Account status scopes the token (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  // The id IS the status, so the DataSource stub can return the right account
  // for whichever status a test is exercising (the guard reads status from the
  // DB by id, never from the token claim).
  const tokenFor = (accountStatus: AccountStatus) =>
    jwt.sign({ id: accountStatus, role: 'COLLECTOR', accountStatus }, { secret: SECRET });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_ACCESS_SECRET: SECRET })],
        }),
        JwtModule.register({ global: true }),
      ],
      controllers: [CartStubController, ApplicationStubController, SessionStubController],
      providers: [
        Reflector,
        ConfigService,
        // Stands in for the live account lookup: the account's status IS its id,
        // which is how each token was signed. An unknown id (a forged token that
        // never reaches this lookup) is not exercised here.
        {
          provide: DataSource,
          useValue: {
            getRepository: () => ({
              findOne: async ({ where }: any) => {
                const id = where?.id;
                return id ? { id, accountStatus: id as AccountStatus } : null;
              },
            }),
          },
        },
        { provide: APP_GUARD, useClass: AccountStatusGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: undefined as any });
    jwt = moduleRef.get(JwtService);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string, status?: AccountStatus) => {
    const req = request(app.getHttpServer()).get(path);
    return status ? req.set('Authorization', `Bearer ${tokenFor(status)}`) : req;
  };

  // ── the point of the whole exercise ─────────────────────────────────────
  it('lets NEED_CHANGES reach the re-upload route', async () => {
    // Being told to replace a document and having no way to reach the route
    // that replaces it is the dead end this work removes.
    await get('/application/reupload', AccountStatus.NEED_CHANGES).expect(200);
  });

  it('lets an applicant read their own application', async () => {
    for (const s of [
      AccountStatus.PENDING_APPROVAL,
      AccountStatus.NEED_CHANGES,
      AccountStatus.REJECTED,
    ]) {
      await get('/application/submission', s).expect(200);
    }
  });

  // ── and the reason it is safe ───────────────────────────────────────────
  it('refuses those same tokens on a route that declares nothing', async () => {
    // The cart, the catalogue, the order routes: 210 of 240 routes declare
    // nothing, and every one of them used to admit any token at all.
    for (const s of [
      AccountStatus.PENDING_APPROVAL,
      AccountStatus.NEED_CHANGES,
      AccountStatus.REJECTED,
    ]) {
      await get('/cart', s).expect(403);
    }
  });

  it('refuses REJECTED on the re-upload route it was not given', async () => {
    await get('/application/reupload', AccountStatus.REJECTED).expect(403);
  });

  it('refuses BLOCKED everywhere', async () => {
    await get('/cart', AccountStatus.BLOCKED).expect(403);
    await get('/application/submission', AccountStatus.BLOCKED).expect(403);
    await get('/application/reupload', AccountStatus.BLOCKED).expect(403);
  });

  it('lets every token-holding status reach the session routes', async () => {
    // logout, device language, notifications — the trap fail-closed created.
    for (const s of TOKEN_HOLDING_STATUSES) {
      await get('/session/logout', s).expect(200);
    }
  });

  it('still refuses BLOCKED on the session routes', async () => {
    await get('/session/logout', AccountStatus.BLOCKED).expect(403);
  });

  it('lets ACTIVE through the undeclared route', async () => {
    await get('/cart', AccountStatus.ACTIVE).expect(200);
  });

  // ── the claim cannot be forged ──────────────────────────────────────────
  it('ignores a token signed with the wrong key', async () => {
    // Decoding instead of verifying would let anyone mint accountStatus:ACTIVE.
    const forged = jwt.sign(
      { id: 'x', accountStatus: AccountStatus.ACTIVE },
      { secret: 'not-the-real-secret' },
    );
    await request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${forged}`)
      .expect(200); // guard abstains; JwtAuthGuard is what 401s in the real app

    // …but it must not grant anything a real status would not: the forged
    // ACTIVE claim is simply not read.
    const forgedOnScoped = jwt.sign(
      { id: 'x', accountStatus: AccountStatus.ACTIVE },
      { secret: 'not-the-real-secret' },
    );
    await request(app.getHttpServer())
      .get('/application/reupload')
      .set('Authorization', `Bearer ${forgedOnScoped}`)
      .expect(200); // same abstention — authentication is JwtAuthGuard's job
  });
});
