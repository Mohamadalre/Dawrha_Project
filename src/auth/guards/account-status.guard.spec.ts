import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountStatusGuard } from './account-status.guard';
import { AccountStatus } from '@src/user/enums/account-status.enum';

/**
 * The property under test is the FAILURE MODE, not the happy path.
 *
 * The guard previously admitted every status on any route that forgot the
 * decorator — 210 of 240 routes. That was survivable only because the statuses
 * it would have admitted never held a token. These tests pin the inversion, so
 * that issuing those tokens cannot silently reopen what was closed.
 *
 * Status now comes from the DATABASE, never the token. Two paths are covered:
 * the fast path (`request.user.accountStatus`, set by a prior guard) and the
 * global-stage path (token id → DB lookup).
 */
describe('AccountStatusGuard', () => {
  let guard: AccountStatusGuard;
  let reflector: Reflector;

  const ctx = (user: any) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as any;

  const declare = (statuses?: AccountStatus[]) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(statuses as any);

  beforeEach(() => {
    reflector = new Reflector();
    guard = new AccountStatusGuard(reflector);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── the inversion ───────────────────────────────────────────────────────
  it('refuses a non-active status on a route that declares nothing', async () => {
    declare(undefined);

    for (const status of [
      AccountStatus.PENDING_APPROVAL,
      AccountStatus.NEED_CHANGES,
      AccountStatus.REJECTED,
      AccountStatus.PENDING_PROFILE,
      AccountStatus.INACTIVE,
    ]) {
      await expect(
        guard.canActivate(ctx({ accountStatus: status })),
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('admits ACTIVE on a route that declares nothing', async () => {
    declare(undefined);
    await expect(
      guard.canActivate(ctx({ accountStatus: AccountStatus.ACTIVE })),
    ).resolves.toBe(true);
  });

  // ── BLOCKED is refused before any whitelist is consulted ────────────────
  it('refuses BLOCKED even where a decorator names it', async () => {
    // No future decorator may readmit a blocked account by mistake.
    declare([AccountStatus.BLOCKED, AccountStatus.ACTIVE]);

    await expect(
      guard.canActivate(ctx({ accountStatus: AccountStatus.BLOCKED })),
    ).rejects.toThrow(/blocked/i);
  });

  // ── an explicit declaration is exhaustive ───────────────────────────────
  it('admits exactly the statuses a route names', async () => {
    declare([AccountStatus.PENDING_APPROVAL, AccountStatus.NEED_CHANGES]);

    await expect(
      guard.canActivate(ctx({ accountStatus: AccountStatus.PENDING_APPROVAL })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx({ accountStatus: AccountStatus.NEED_CHANGES })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx({ accountStatus: AccountStatus.REJECTED })),
    ).rejects.toThrow();
  });

  it('keeps ACTIVE out of a route that deliberately excludes it', async () => {
    // An onboarding step marked PENDING_PROFILE excludes ACTIVE on purpose: an
    // approved account has no business re-running its own registration. An
    // early "ACTIVE always passes" shortcut would have quietly opened all 30
    // routes that carry a declaration.
    declare([AccountStatus.PENDING_PROFILE]);

    await expect(
      guard.canActivate(ctx({ accountStatus: AccountStatus.ACTIVE })),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── anonymous requests are somebody else's decision ─────────────────────
  it('does not judge an unauthenticated request', async () => {
    declare(undefined);
    // Whether a caller may be anonymous at all is JwtAuthGuard's call; this
    // guard only classifies a status it has been given.
    await expect(guard.canActivate(ctx(undefined))).resolves.toBe(true);
  });

  it('refuses an authenticated request whose status cannot be determined', async () => {
    declare([AccountStatus.PENDING_APPROVAL]);
    await expect(guard.canActivate(ctx({ id: 'x' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ── the DB-lookup path (global stage, before JwtAuthGuard runs) ──────────
  describe('status resolved from the database by token id', () => {
    const ctxToken = (token?: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: token ? { authorization: `Bearer ${token}` } : {},
          }),
        }),
        getHandler: () => undefined,
        getClass: () => undefined,
      }) as any;

    const build = (dbStatus: AccountStatus | null) => {
      const jwtService = { verify: jest.fn().mockReturnValue({ id: 'a1' }) } as any;
      const configService = { get: jest.fn().mockReturnValue('secret') } as any;
      const accountRepo = {
        findOne: jest.fn().mockResolvedValue(
          dbStatus ? { id: 'a1', accountStatus: dbStatus } : null,
        ),
      };
      const dataSource = { getRepository: jest.fn().mockReturnValue(accountRepo) } as any;
      return {
        guard: new AccountStatusGuard(reflector, jwtService, configService, dataSource),
        accountRepo,
        jwtService,
      };
    };

    it('reads the LIVE status from the DB, not the token', async () => {
      // The route wants PENDING_APPROVAL; the DB says PENDING_APPROVAL even
      // though the token (minted at PENDING_PROFILE) carries no status at all.
      declare([AccountStatus.PENDING_APPROVAL]);
      const { guard: g, accountRepo } = build(AccountStatus.PENDING_APPROVAL);

      await expect(g.canActivate(ctxToken('tkn'))).resolves.toBe(true);
      expect(accountRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a1' } }),
      );
    });

    it('refuses when the DB status is not allowed, regardless of the token', async () => {
      declare([AccountStatus.PENDING_APPROVAL]);
      const { guard: g } = build(AccountStatus.PENDING_PROFILE);

      await expect(g.canActivate(ctxToken('tkn'))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('treats an unverifiable token as anonymous (JwtAuthGuard answers it)', async () => {
      declare(undefined);
      const { guard: g, jwtService } = build(AccountStatus.ACTIVE);
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad signature');
      });

      await expect(g.canActivate(ctxToken('tkn'))).resolves.toBe(true);
    });

    it('is anonymous when there is no bearer token', async () => {
      declare(undefined);
      const { guard: g } = build(AccountStatus.ACTIVE);
      await expect(g.canActivate(ctxToken(undefined))).resolves.toBe(true);
    });
  });
});
