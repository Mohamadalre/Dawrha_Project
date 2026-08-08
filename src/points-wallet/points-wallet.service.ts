import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { PointsWallet } from './entities/points-wallet.entity';

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
  ) {}

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
