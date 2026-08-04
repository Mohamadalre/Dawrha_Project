import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { ACCOUNTSTATUS_KEY } from '../decorators/account-status.decorator';

/**
 * What an account may reach, decided by its status — and DENIED BY DEFAULT.
 *
 * The guard used to read:
 *
 *     if (!requiredAccountStatus) return true;
 *
 * so a route with no `@AccountsStatus` decorator admitted every status. Of 240
 * routes only 30 carried one, which left 210 open to any token at all.
 *
 * That was safe purely by accident: PENDING_APPROVAL, NEED_CHANGES and REJECTED
 * were never issued a token, so nobody could present one. The moment those
 * statuses receive tokens — which the product requires, so an applicant can see
 * their own application and replace a rejected document — all 210 would have
 * opened to them at once: cart, orders, catalogue, pricing.
 *
 * So the rule is inverted. An undecorated route now requires ACTIVE, and a
 * route is opened to other statuses only by naming them explicitly. Forgetting
 * the decorator locks a route down instead of exposing it, and adding an
 * endpoint can no longer silently widen access.
 *
 * BLOCKED is refused everywhere, unconditionally — it is rejected before any
 * whitelist is consulted, so no future decorator can readmit it by mistake.
 */
@Injectable()
export class AccountStatusGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly jwtService?: JwtService,
    private readonly configService?: ConfigService,
  ) {}

  /**
   * The status this request carries, from `request.user` when an earlier guard
   * has already run, otherwise from the token itself.
   *
   * Reading the token here is what makes the guard safe to register globally.
   * `JwtAuthGuard` is applied per-controller in 39 places, and Nest runs GLOBAL
   * guards BEFORE controller-bound ones — so a global guard that only trusted
   * `request.user` would read `undefined` on every route and wave everything
   * through, which is the failure it exists to prevent.
   *
   * The token is VERIFIED, never merely decoded: `accountStatus` is a claim
   * inside it, so decoding without checking the signature would let anyone mint
   * `{"accountStatus":"ACTIVE"}` and walk past this guard entirely.
   *
   * A token that fails verification yields no status; the request then falls
   * through to `JwtAuthGuard`, whose job it is to reject it with a 401.
   */
  private statusOf(request: any): AccountStatus | undefined {
    if (request.user?.accountStatus) return request.user.accountStatus;
    if (!this.jwtService || !this.configService) return undefined;

    const [type, token] = (request.headers?.authorization || '').split(' ');
    if (type !== 'Bearer' || !token) return undefined;
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
      return payload?.accountStatus as AccountStatus | undefined;
    } catch {
      return undefined; // invalid/expired — JwtAuthGuard answers that
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const status = this.statusOf(request);

    if (!status) {
      // An AUTHENTICATED request with no status is malformed, and malformed is
      // refused — not waved through on the assumption it must be anonymous.
      if (request.user) {
        throw new ForbiddenException('Your account status could not be determined.');
      }
      // Genuinely anonymous (or a token JwtAuthGuard is about to reject with a
      // 401). Whether a caller may be unauthenticated is that guard's decision.
      return true;
    }

    // A blocked account can do nothing, whatever a route declares.
    if (status === AccountStatus.BLOCKED) {
      throw new ForbiddenException('Your account has been blocked.');
    }

    const allowed = this.reflector.getAllAndOverride<AccountStatus[]>(
      ACCOUNTSTATUS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No declaration = ACTIVE only. This is the inversion described above.
    if (!allowed?.length) {
      if (status === AccountStatus.ACTIVE) return true;
      throw new ForbiddenException(
        'Your account is not active yet. You can view your application and complete the steps required of you.',
      );
    }

    // A declaration is exhaustive, ACTIVE included. Letting ACTIVE through
    // ahead of this check would have quietly widened the 30 routes that
    // already carry one — an onboarding step marked PENDING_PROFILE excludes
    // ACTIVE on purpose, because an approved account has no business re-running
    // its own registration.
    if (!status || !allowed.includes(status)) {
      throw new ForbiddenException(
        'Your account is not active yet. You can view your application and complete the steps required of you.',
      );
    }
    return true;
  }
}
