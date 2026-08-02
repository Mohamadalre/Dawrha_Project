import { HttpException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import {
  EmailRegisteredWithGoogleException,
  InvalidCredentialsException,
  SocialLoginRequiredException,
} from './exceptions/auth.exceptions';
import { AuthProvider } from '@src/user/enums/auth-provider.enum';
import { Role } from '@src/user/enums/role.enum';


/**
 * Unit tests for the OTP resend policy (cooldown + daily cap) in AuthService.
 * Only the collaborators used by resendOtpCode are given real mocks.
 */
describe('AuthService.resendOtpCode', () => {
  let service: AuthService;
  let userService: any;
  let redis: any;
  let mailService: any;

  const build = () => {
    userService = { findById: jest.fn().mockResolvedValue({ id: 'u1', email: 'u@e.com' }) };
    redis = { ttl: jest.fn(), incr: jest.fn(), expire: jest.fn().mockResolvedValue(1) };
    mailService = { generateAndSendOtp: jest.fn().mockResolvedValue(undefined) };

    // Remaining 11 constructor deps are unused by resendOtpCode.
    const noop: any = {};
    return new AuthService(
      userService, // userService
      noop, // jwtService
      noop, // configService
      noop, // redisService
      noop, // userDeviceRepository
      noop, // accountRepository
      redis, // REDIS_CLIENT
      mailService, // mailService
      noop, noop, noop, noop, noop, noop, noop, // 7 login handlers
    );
  };

  beforeEach(() => {
    service = build();
  });

  it('throws 429 while the cooldown is still active and does not resend', async () => {
    redis.ttl.mockResolvedValue(45); // 45s left

    await expect(service.resendOtpCode('u1')).rejects.toBeInstanceOf(HttpException);
    expect(mailService.generateAndSendOtp).not.toHaveBeenCalled();
  });

  it('throws 429 when the daily resend cap is exceeded', async () => {
    redis.ttl.mockResolvedValue(-2); // no cooldown
    redis.incr.mockResolvedValue(11); // over the 10/day cap

    await expect(service.resendOtpCode('u1')).rejects.toBeInstanceOf(HttpException);
    expect(mailService.generateAndSendOtp).not.toHaveBeenCalled();
  });

  it('resends and returns the cooldown when allowed', async () => {
    redis.ttl.mockResolvedValue(-2);
    redis.incr.mockResolvedValue(1); // first resend today

    const res = await service.resendOtpCode('u1');

    expect(redis.expire).toHaveBeenCalledWith('otp:resend:count:u@e.com', 86400);
    expect(mailService.generateAndSendOtp).toHaveBeenCalledWith('u@e.com');
    expect(res.cooldownSeconds).toBe(120);
  });
});

/**
 * A Google account carries no password hash. Before these guards existed the
 * password form handed `null` straight to argon2, which threw "pchstr must be a
 * non-empty string" and surfaced as a 500 — an internal error for what is an
 * ordinary user mistake, and one that told the user nothing they could act on.
 *
 * The discriminator under test is deliberately the ABSENCE OF A PASSWORD rather
 * than the provider flag: an account that registered locally and later signed in
 * with Google has `provider = GOOGLE` and a perfectly usable password, and must
 * keep being able to use it.
 */
describe('AuthService — accounts created through Google', () => {
  let accountRepository: any;
  let mailService: any;
  let service: AuthService;

  const LOGIN = {
    email: 'g@e.com',
    password: 'whatever',
    deviceId: 'd1',
    fcmToken: 't',
    deviceType: 'ANDROID' as any,
    rememberMy: false,
  };

  const build = (account: any) => {
    accountRepository = {
      findOne: jest.fn().mockResolvedValue(account),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
    };
    mailService = {
      generateAndSendOtp: jest.fn().mockResolvedValue(undefined),
      generateAndSendOtpForgot: jest.fn().mockResolvedValue(undefined),
    };
    const redis = {
      ttl: jest.fn().mockResolvedValue(-2),
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const activeHandler = { handle: jest.fn().mockResolvedValue({ ok: true }) };
    const noop: any = {};
    return new AuthService(
      noop, // userService
      noop, // jwtService
      noop, // configService
      noop, // redisService
      noop, // userDeviceRepository
      accountRepository,
      redis as any,
      mailService,
      activeHandler as any,
      noop, noop, noop, noop, noop, noop, // remaining 6 handlers
    );
  };

  const googleOnly = {
    id: 'a1',
    email: 'g@e.com',
    role: Role.CITIZEN,
    accountStatus: 'ACTIVE',
    passwordHash: null,
    googleId: 'google-123',
    provider: AuthProvider.GOOGLE,
  };

  it('answers a password login on a Google account with a 400 naming Google, not a 500', async () => {
    service = build(googleOnly);

    await expect(service.login(LOGIN, 'user_app')).rejects.toBeInstanceOf(
      SocialLoginRequiredException,
    );
  });

  it('returns 400 with an actionable code, not the argon2 crash', async () => {
    service = build(googleOnly);

    // The old behaviour was a TypeError escaping argon2 ("pchstr must be a
    // non-empty string") that the filter rendered as 500 with no errorCode.
    // Asserting the status AND the code pins both halves of the fix.
    const err = await service.login(LOGIN, 'user_app').catch((e) => e);

    expect(err).toBeInstanceOf(SocialLoginRequiredException);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toMatchObject({ errorCode: 'SOCIAL_LOGIN_REQUIRED' });
  });

  /**
   * A HYBRID account: registered locally, later signed in with Google.
   *
   * `provider` is rewritten to GOOGLE by that flow while the password stays
   * perfectly usable — which is exactly why the guard keys on the ABSENCE OF A
   * PASSWORD rather than on the provider flag. Judging by the flag would lock
   * these users out of the form they have always used.
   *
   * The hash is computed ONCE. argon2 is deliberately slow — that is its whole
   * purpose — so hashing inside each test blows Jest's default timeout as soon
   * as the full suite runs them under load.
   */
  let hybridHash: string;
  beforeAll(async () => {
    hybridHash = await argon2.hash('correct-horse');
  }, 30_000);

  it('still lets a hybrid account (Google-linked but password-holding) log in', async () => {
    service = build({ ...googleOnly, passwordHash: hybridHash });

    const res = await service.login({ ...LOGIN, password: 'correct-horse' }, 'user_app');

    expect(res.role).toBe(Role.CITIZEN);
  }, 30_000);

  it('answers a wrong password on a hybrid account with the generic credentials error', async () => {
    service = build({ ...googleOnly, passwordHash: hybridHash });

    await expect(service.login(LOGIN, 'user_app')).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  }, 30_000);

  it('refuses local registration on a Google address and does not mail an OTP', async () => {
    service = build(googleOnly);

    await expect(
      service.register(
        { fullName: 'X', email: 'g@e.com', phoneNumber: '0900', password: 'p' } as any,
        Role.CITIZEN,
      ),
    ).rejects.toBeInstanceOf(EmailRegisteredWithGoogleException);

    expect(mailService.generateAndSendOtp).not.toHaveBeenCalled();
  });

  it('sends no reset code for a Google account, and the response stays indistinguishable', async () => {
    service = build(googleOnly);

    const res = await service.forgotPassword({ email: 'g@e.com' } as any);

    expect(mailService.generateAndSendOtpForgot).not.toHaveBeenCalled();
    // Byte-identical to the answer given for an address that does not exist —
    // the guard must not become an account-enumeration oracle.
    expect(res.message).toBe('If this email exists, an OTP has been sent.');
  });

  it('does send a reset code for an ordinary local account', async () => {
    service = build({ ...googleOnly, passwordHash: 'hash', googleId: null, provider: AuthProvider.LOCAL });

    await service.forgotPassword({ email: 'g@e.com' } as any);

    expect(mailService.generateAndSendOtpForgot).toHaveBeenCalledWith('g@e.com');
  });
});

/**
 * Signing in with Google, on an account that never finished its OTP.
 *
 * `verifyGoogleToken` refuses a token whose `email_verified` claim is false, so
 * reaching the service means Google itself vouches that this person controls
 * this mailbox — the same fact an emailed code establishes, from a stronger
 * source. Treating that as unverified asks somebody to prove twice what has
 * already been proven once.
 *
 * The flag alone would not be enough, which is the part worth pinning: an
 * account that registered with a password and never entered the code sits at
 * INACTIVE, and the INACTIVE handler answers every sign-in with
 * `NoActive_ACCOUNT`. Verifying the email and leaving the status there produces
 * an account that is verified, permanently refused, and no longer has a pending
 * code to rescue it.
 */
jest.mock('./utils/providers/google.provider', () => ({
  verifyGoogleToken: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyGoogleToken } = require('./utils/providers/google.provider');

describe('AuthService.loginWithGoogle — the mailbox is already proven', () => {
  let service: AuthService;
  let accountRepository: any;
  let account: any;
  const handled: any[] = [];

  // Cast at the boundary: the handlers have their own injected collaborators
  // that none of these tests reach, and building seven real ones would test
  // the container rather than the rule under examination.
  const handler = (name: string): any => ({
    handle: jest.fn(async (acc: any) => {
      handled.push({ name, status: acc.accountStatus });
      return { status: name };
    }),
  });

  beforeEach(() => {
    handled.length = 0;
    verifyGoogleToken.mockResolvedValue({
      email: 'u@e.com',
      googleId: 'g-1',
      name: 'U',
      picture: null,
    });
    account = {
      id: 'u1',
      email: 'u@e.com',
      role: Role.CITIZEN,
      googleId: 'g-1',
      accountStatus: 'INACTIVE',
      isEmailVerified: false,
    };
    accountRepository = {
      findOne: jest.fn(async () => account),
      save: jest.fn(async (a: any) => a),
    };
    const noop: any = {};
    service = new AuthService(
      noop, noop, noop, noop, noop,
      accountRepository,
      noop, noop,
      handler('ACTIVE'),
      handler('PENDING_APPROVAL'),
      handler('PENDING_PROFILE'),
      handler('BLOCKED'),
      handler('REJECTED'),
      handler('INACTIVE'),
      handler('NEED_CHANGES'),
    );
  });

  const login = () =>
    service.loginWithGoogle(
      { TokenId: 't', deviceId: 'd1' } as any,
      'user_app',
    );

  it('marks the email verified', async () => {
    await login();
    expect(account.isEmailVerified).toBe(true);
  });

  it('does not leave the account stranded at INACTIVE', async () => {
    // A verified email on a permanently-refused account is worse than an
    // unverified one: there is no pending code left to rescue it.
    await login();
    expect(account.accountStatus).toBe('ACTIVE');
    expect(handled.map((h) => h.name)).not.toContain('INACTIVE');
  });

  it('settles a non-citizen to the profile step, exactly as the OTP does', async () => {
    // Same rule, because this IS that step arrived at by another door — a
    // second rule here is a second place for the two to drift apart.
    //
    // An institution rather than a factory: the app gate runs first, and
    // factories belong to `factory_app`. Testing the status rule through a
    // door the role cannot enter would only ever prove the gate works.
    account.role = Role.INSTITUTIONS;
    await login();
    expect(account.accountStatus).toBe('PENDING_PROFILE');
  });

  it('checks which app the role belongs to before anything else', async () => {
    // A factory has no business signing in through the user app, verified
    // mailbox or not — and it must be turned away without its account being
    // quietly edited on the way out.
    account.role = Role.FACTORY;

    await expect(login()).rejects.toBeInstanceOf(HttpException);
    expect(account.isEmailVerified).toBe(false);
  });

  it('leaves an account that is already past this alone', async () => {
    account.isEmailVerified = true;
    account.accountStatus = 'PENDING_APPROVAL';

    await login();

    expect(account.accountStatus).toBe('PENDING_APPROVAL');
    expect(accountRepository.save).not.toHaveBeenCalled();
  });

  it('does not resurrect a REJECTED or BLOCKED account', async () => {
    // Only INACTIVE means "never finished verifying". The other statuses are
    // decisions somebody took, and verifying an email does not overturn one.
    for (const status of ['REJECTED', 'BLOCKED']) {
      account.accountStatus = status;
      account.isEmailVerified = false;
      await login();
      expect(account.accountStatus).toBe(status);
    }
  });
});
