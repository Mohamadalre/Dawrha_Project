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
  it('refuses a non-active status on a route that declares nothing', () => {
    declare(undefined);

    for (const status of [
      AccountStatus.PENDING_APPROVAL,
      AccountStatus.NEED_CHANGES,
      AccountStatus.REJECTED,
      AccountStatus.PENDING_PROFILE,
      AccountStatus.INACTIVE,
    ]) {
      expect(() => guard.canActivate(ctx({ accountStatus: status }))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('admits ACTIVE on a route that declares nothing', () => {
    declare(undefined);
    expect(guard.canActivate(ctx({ accountStatus: AccountStatus.ACTIVE }))).toBe(true);
  });

  // ── BLOCKED is refused before any whitelist is consulted ────────────────
  it('refuses BLOCKED even where a decorator names it', () => {
    // No future decorator may readmit a blocked account by mistake.
    declare([AccountStatus.BLOCKED, AccountStatus.ACTIVE]);

    expect(() => guard.canActivate(ctx({ accountStatus: AccountStatus.BLOCKED }))).toThrow(
      /blocked/i,
    );
  });

  // ── an explicit declaration is exhaustive ───────────────────────────────
  it('admits exactly the statuses a route names', () => {
    declare([AccountStatus.PENDING_APPROVAL, AccountStatus.NEED_CHANGES]);

    expect(guard.canActivate(ctx({ accountStatus: AccountStatus.PENDING_APPROVAL }))).toBe(true);
    expect(guard.canActivate(ctx({ accountStatus: AccountStatus.NEED_CHANGES }))).toBe(true);
    expect(() => guard.canActivate(ctx({ accountStatus: AccountStatus.REJECTED }))).toThrow();
  });

  it('keeps ACTIVE out of a route that deliberately excludes it', () => {
    // An onboarding step marked PENDING_PROFILE excludes ACTIVE on purpose: an
    // approved account has no business re-running its own registration. An
    // early "ACTIVE always passes" shortcut would have quietly opened all 30
    // routes that carry a declaration.
    declare([AccountStatus.PENDING_PROFILE]);

    expect(() => guard.canActivate(ctx({ accountStatus: AccountStatus.ACTIVE }))).toThrow(
      ForbiddenException,
    );
  });

  // ── anonymous requests are somebody else's decision ─────────────────────
  it('does not judge an unauthenticated request', () => {
    declare(undefined);
    // Whether a caller may be anonymous at all is JwtAuthGuard's call; this
    // guard only classifies a status it has been given.
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('refuses a token that carries no status at all', () => {
    declare([AccountStatus.PENDING_APPROVAL]);
    expect(() => guard.canActivate(ctx({ id: 'x' }))).toThrow(ForbiddenException);
  });
});
