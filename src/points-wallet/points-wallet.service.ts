import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { PointsWallet } from './entities/points-wallet.entity';
import { PointsRateService } from './points-rate.service';
import { LeaderboardSnapshotService } from './leaderboard-snapshot.service';
import { deriveTrend } from './leaderboard-trend';
import { Stage } from '@src/stages/entities/stage.entity';

/**
 * The roles that TRADE and therefore earn points: citizens and institutions
 * (sellers), factories and free facilities (buyers). Admins never trade, and a
 * collector delivers rather than buys or sells — none of them get a wallet.
 */
export const WALLET_ELIGIBLE_ROLES: readonly Role[] = [
  Role.CITIZEN,
  Role.INSTITUTIONS,
  Role.FACTORY,
  Role.EXTERNAL_PARTNER,
];

export function isWalletEligible(role: Role): boolean {
  return WALLET_ELIGIBLE_ROLES.includes(role);
}

@Injectable()
export class PointsWalletService {
  private readonly logger = new Logger('PointsWallet');

  constructor(
    @InjectRepository(PointsWallet)
    private readonly walletRepo: Repository<PointsWallet>,
    private readonly rates: PointsRateService,
    private readonly notifications: NotificationService,
    @InjectRepository(Stage)
    private readonly stageRepo: Repository<Stage>,
    private readonly snapshots: LeaderboardSnapshotService,
  ) {}

  /**
   * Reward a COMPLETED order: convert its value to points at the buyer's role
   * rate and credit their wallet, then tell them.
   *
   * `points = floor(orderValue / amountPerPoint)` — a 3000 order at 1000-per-
   * point earns 3. Returns null when the admin has set no rate for the role (no
   * conversion, so nothing is awarded), and awards nothing when the value is too
   * small to earn a whole point. Best-effort: a wallet or notification hiccup
   * must never fail the receipt that triggered it.
   */
  async awardForOrder(
    accountId: string,
    role: Role,
    orderValue: number,
    orderNumber?: string,
  ): Promise<{ points: number; balance: number } | null> {
    try {
      const rate = await this.rates.forRole(role);
      if (!rate) return null;
      const per = Number(rate.amountPerPoint);
      if (!(per > 0) || !(orderValue > 0)) return null;

      const points = Math.floor(orderValue / per);
      if (points <= 0) return { points: 0, balance: (await this.view(accountId, role)).points };

      const wallet = await this.ensureForAccount(accountId, role);
      if (!wallet) return null;

      // Capture the standings BEFORE this award so the leaderboard trend reflects
      // exactly the movement this points change causes — the user who climbs
      // rises, whoever they overtake drops — the instant it happens, not a day
      // later. Best-effort: it must never hold up (or fail) the actual award.
      await this.snapshots.refreshBaseline().catch(() => undefined);

      wallet.points += points;
      await this.walletRepo.save(wallet);

      await this.notifications
        .createNotification({
          userId: accountId,
          type: NotificationType.GENERAL,
          title: `You earned ${points} point(s)`,
          body: `You have been gifted ${points} point(s) in your wallet for receiving order ${orderNumber ?? ''}.`,
          titleKey: 'notifications.pointsEarned.title',
          bodyKey: 'notifications.pointsEarned.body',
          args: { points, order: orderNumber ?? '' },
        })
        .catch((e) =>
          this.logger.warn(
            `Points credited but the notification was not queued for ${accountId}: ${e instanceof Error ? e.message : e}`,
          ),
        );

      return { points, balance: wallet.points };
    } catch (e) {
      this.logger.warn(
        `Could not award points for ${accountId}: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }

  /**
   * Make sure an eligible account has a wallet, creating an empty one if not.
   *
   * Idempotent and safe to call from every activation path (admin approval, OTP
   * verification, Google sign-up): a second call finds the existing wallet and
   * does nothing. Returns null for a role that never gets one, so callers can
   * fire it unconditionally without re-checking eligibility.
   *
   * Never allowed to break the flow that activated the account — a wallet that
   * fails to create is logged and retried lazily on the next read.
   */
  async ensureForAccount(accountId: string, role: Role): Promise<PointsWallet | null> {
    if (!isWalletEligible(role)) return null;
    try {
      const existing = await this.walletRepo.findOne({ where: { accountId } });
      if (existing) return existing;
      // A unique constraint on account_id makes a race harmless: the loser's
      // insert fails, and it simply reads the winner's wallet back.
      try {
        return await this.walletRepo.save(
          this.walletRepo.create({ accountId, points: 0 }),
        );
      } catch {
        return this.walletRepo.findOne({ where: { accountId } });
      }
    } catch (e) {
      this.logger.warn(
        `Could not ensure a points wallet for ${accountId}: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }

  /**
   * The caller's own wallet, in the shape the view route returns. Creates it
   * lazily if an eligible active account somehow has none yet (a belt to the
   * activation-time braces above).
   */
  async view(accountId: string, role: Role) {
    const wallet =
      (await this.walletRepo.findOne({ where: { accountId } })) ??
      (await this.ensureForAccount(accountId, role));
    return {
      points: wallet?.points ?? 0,
      currency: 'POINTS',
      wallet_id: wallet?.id ?? null,
    };
  }

  /**
   * The points leaderboard — every wallet-holder ranked by points, highest first.
   *
   * Paginated. Each row carries its 1-based position (1st, 2nd, …), the holder's
   * name and role, and their points. Ties are broken by who reached the balance
   * first (the older wallet ranks higher), so the order — and therefore the page
   * boundaries — is stable across requests rather than shuffling on every call.
   *
   * The caller's OWN rank is returned alongside, so a user whose row is off the
   * current page still sees where they stand.
   *
   * Scope: CITIZEN accounts only — the leaderboard is the citizens' standing, so
   * institutions, factories, free facilities (and roles with no wallet at all —
   * drivers, admins) never appear on it. Only ACTIVE accounts count: a
   * deactivated one is not a current user.
   */
  async leaderboard(page: number, limit: number, callerAccountId?: string) {
    const p = Math.max(1, Math.floor(page) || 1);
    const l = Math.min(Math.max(1, Math.floor(limit) || 20), 100);
    const offset = (p - 1) * l;

    // A fresh builder each call — ACTIVE CITIZEN accounts only, for the counts.
    const active = () =>
      this.walletRepo
        .createQueryBuilder('w')
        .innerJoin('w.account', 'a')
        .where('a.accountStatus = :status', { status: AccountStatus.ACTIVE })
        .andWhere('a.role = :role', { role: Role.CITIZEN });

    const total = await active().getCount();

    const rows = await this.walletRepo
      .createQueryBuilder('w')
      .innerJoinAndSelect('w.account', 'a')
      .where('a.accountStatus = :status', { status: AccountStatus.ACTIVE })
      .andWhere('a.role = :role', { role: Role.CITIZEN })
      .orderBy('w.points', 'DESC')
      .addOrderBy('w.createdAt', 'ASC')
      .skip(offset)
      .take(l)
      .getMany();

    // Each user's CURRENT stage name — the active band their points fall in, or
    // null when they are in none. Stages are loaded once for the whole page
    // rather than per row (ranges never overlap, so at most one matches).
    const stages = await this.stageRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
    const stageName = (pts: number): string | null =>
      stages.find((s) => pts >= s.minPoints && pts <= s.maxPoints)?.name ?? null;

    // The BASELINE rank of everyone on this page (and the caller), from the last
    // daily snapshot — so each row can say whether the user climbed, slipped or
    // held since then. One query for the whole page.
    const pageAccountIds = rows.map((w) => w.accountId);
    if (callerAccountId) pageAccountIds.push(callerAccountId);
    const previousRanks = await this.snapshots.previousRanks(pageAccountIds);

    const leaderboard = rows.map((w, i) => {
      const rank = offset + i + 1;
      // trend: UP (climbed) / DOWN (slipped) / SAME (held or first appearance),
      // measured against the user's rank at the last daily snapshot.
      const { trend, rank_change } = deriveTrend(rank, previousRanks.get(w.accountId));
      return {
        rank,
        account_id: w.accountId,
        name: w.account?.name ?? null,
        points: w.points,
        // The user's stage — its NAME only, as requested.
        stage: stageName(w.points),
        trend,
        rank_change,
      };
    });

    // The caller's own standing — null unless they are an ACTIVE CITIZEN (no
    // wallet, or a non-citizen role, means they are not on this leaderboard).
    let me:
      | { rank: number; points: number; stage: string | null; trend: string; rank_change: number }
      | null = null;
    if (callerAccountId) {
      const mine = await this.walletRepo
        .createQueryBuilder('w')
        .innerJoin('w.account', 'a')
        .where('w.accountId = :id', { id: callerAccountId })
        .andWhere('a.accountStatus = :status', { status: AccountStatus.ACTIVE })
        .andWhere('a.role = :role', { role: Role.CITIZEN })
        .getOne();
      if (mine) {
        // Same positional rule as the list: everyone strictly ahead on points,
        // plus everyone tied who reached the balance earlier, plus one.
        const ahead = await active()
          .andWhere('w.points > :pts', { pts: mine.points })
          .getCount();
        const tiedAhead = await active()
          .andWhere('w.points = :pts', { pts: mine.points })
          .andWhere('w.createdAt < :createdAt', { createdAt: mine.createdAt })
          .getCount();
        const myRank = ahead + tiedAhead + 1;
        const myTrend = deriveTrend(myRank, previousRanks.get(callerAccountId));
        me = {
          rank: myRank,
          points: mine.points,
          stage: stageName(mine.points),
          trend: myTrend.trend,
          rank_change: myTrend.rank_change,
        };
      }
    }

    return {
      me,
      leaderboard,
      pagination: {
        total,
        page: p,
        limit: l,
        total_pages: l > 0 ? Math.ceil(total / l) : 0,
        has_next: p * l < total,
        has_prev: p > 1,
      },
    };
  }
}
