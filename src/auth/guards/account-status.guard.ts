import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
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
    // Marked @Optional() to match how the guard actually behaves: `statusOf`
    // returns undefined when any of these is absent (the request then falls
    // through to JwtAuthGuard). Without the decorator Nest treats an optional
    // TS param as REQUIRED and refuses to construct the guard in any injector
    // that lacks the provider — which is exactly what broke it under @UseGuards
    // and in tests, even though the runtime path tolerates their absence.
    @Optional() private readonly jwtService?: JwtService,
    @Optional() private readonly configService?: ConfigService,
    // The DataSource (not a per-feature repository): this guard is applied both
    // globally and — in a handful of controllers — via @UseGuards, so it is
    // instantiated in several module injectors. DataSource is registered
    // globally by TypeOrmModule, so it resolves in all of them; a
    // @InjectRepository(Account) would force every such module to import
    // forFeature([Account]) and break the moment one forgot.
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  /**
   * The account's LIVE status, read from the database — never from the token.
   *
   * The token carries only the account id (its status claim was removed): a
   * token minted while the account was PENDING_PROFILE would otherwise keep
   * reporting PENDING_PROFILE for its whole lifetime, so an applicant who
   * submitted their request (now PENDING_APPROVAL) — or was approved (ACTIVE) —
   * stayed locked to the old status until the token expired. The id is the only
   * status-bearing claim now, and the status is looked up fresh each request.
   *
   * Two sources, in order:
   *  - `request.user` when an earlier guard already ran — `JwtStrategy` sets
   *    `accountStatus` there from the DB, so it is already live;
   *  - otherwise the token id → a DB lookup. Reading the DB here is what keeps
   *    the guard safe to register globally: Nest runs GLOBAL guards BEFORE
   *    controller-bound ones, so a global guard that trusted only `request.user`
   *    would read `undefined` on every route and wave everything through.
   *
   * The token is VERIFIED, never merely decoded — a forged id would otherwise
   * pick whatever account it named. A token that fails verification yields no
   * status; the request then falls through to `JwtAuthGuard` for its 401.
   */
  private async statusOf(request: any): Promise<AccountStatus | undefined> {
    if (request.user?.accountStatus) return request.user.accountStatus;
    if (!this.jwtService || !this.configService || !this.dataSource) {
      return undefined;
    }

    const [type, token] = (request.headers?.authorization || '').split(' ');
    if (type !== 'Bearer' || !token) return undefined;
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      return undefined; // invalid/expired — JwtAuthGuard answers that
    }

    const id = payload?.id || payload?.sub;
    if (!id) return undefined;
    const account = await this.dataSource.getRepository(Account).findOne({
      where: { id },
      select: { id: true, accountStatus: true },
    });
    return account?.accountStatus;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const status = await this.statusOf(request);

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
