import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { PointsWallet } from './entities/points-wallet.entity';
import { PointsRateService } from './points-rate.service';

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
}
