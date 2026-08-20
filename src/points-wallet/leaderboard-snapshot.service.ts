import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { PointsWallet } from './entities/points-wallet.entity';
import { LeaderboardSnapshot } from './entities/leaderboard-snapshot.entity';

/**
 * Keeps the leaderboard BASELINE current, so the live board can show each user's
 * trend (↑ up / ↓ down / = same) against where they stood a day ago.
 *
 * The snapshot is taken by a daily cron that runs ONLY in the worker process
 * (gated by MAINTENANCE_WORKER, like every other cron here) — the API instances
 * never take it, so several API replicas do not each rewrite the baseline.
 */
@Injectable()
export class LeaderboardSnapshotService {
  private readonly logger = new Logger(LeaderboardSnapshotService.name);

  constructor(
    @InjectRepository(PointsWallet)
    private readonly walletRepo: Repository<PointsWallet>,
    @InjectRepository(LeaderboardSnapshot)
    private readonly snapshotRepo: Repository<LeaderboardSnapshot>,
  ) {}

  private isWorker(): boolean {
    return process.env.MAINTENANCE_WORKER === 'true';
  }

  /**
   * A daily SAFETY refresh of the baseline, in the worker only — so the trend
   * never drifts stale on a board where no points were awarded for a long time.
   * The live movement is driven by {@link refreshBaseline}, called the instant
   * points change (see PointsWalletService.awardForOrder); this is just a floor.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async takeDailySnapshot(): Promise<void> {
    if (!this.isWorker()) return;
    await this.refreshBaseline();
  }

  /**
   * Capture the CURRENT standings as the trend baseline: rank every ACTIVE
   * CITIZEN exactly as the leaderboard orders them (points DESC, then oldest
   * wallet first) and UPSERT one row per account.
   *
   * Called the moment BEFORE points are awarded, so the baseline is "where
   * everyone stood just before this change" — then the live leaderboard compares
   * the new ranks to it and shows the movement that this very change caused
   * (the user who was overtaken drops, the one who climbed rises). Best-effort:
   * a failure here must never block the points award that triggered it.
   */
  async refreshBaseline(): Promise<void> {
    const takenAt = new Date();

    // ROW_NUMBER gives the exact rank the leaderboard would show, in one pass,
    // for the same population (active citizens) and the same tie-break.
    const ranked: Array<{ account_id: string; points: number; rank: string }> =
      await this.walletRepo.query(
        `SELECT w.account_id,
                w.points,
                ROW_NUMBER() OVER (ORDER BY w.points DESC, w.created_at ASC) AS rank
           FROM points_wallets w
           JOIN accounts a ON a.id = w.account_id
          WHERE a.account_status = $1 AND a.role = $2`,
        [AccountStatus.ACTIVE, Role.CITIZEN],
      );
    if (!ranked.length) return;

    // Upsert one baseline per account — the account id is unique, so a conflict
    // overwrites yesterday's row with today's.
    const values = ranked
      .map(
        (_r, i) =>
          `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`,
      )
      .join(', ');
    const params: any[] = [];
    for (const r of ranked) {
      params.push(r.account_id, Number(r.rank), r.points, takenAt);
    }
    await this.snapshotRepo.query(
      `INSERT INTO leaderboard_snapshots (account_id, rank, points, taken_at)
       VALUES ${values}
       ON CONFLICT (account_id)
       DO UPDATE SET rank = EXCLUDED.rank,
                     points = EXCLUDED.points,
                     taken_at = EXCLUDED.taken_at,
                     "updatedAt" = now()`,
      params,
    );

    // Drop baselines of accounts that are no longer active citizens, so a
    // deactivated user's stale rank never lingers.
    const liveIds = ranked.map((r) => r.account_id);
    await this.snapshotRepo.query(
      `DELETE FROM leaderboard_snapshots WHERE account_id <> ALL($1::uuid[])`,
      [liveIds],
    );

    this.logger.log(`Leaderboard baseline snapshot: ${ranked.length} citizen(s)`);
  }

  /**
   * The baseline rank of each of these accounts (from the last snapshot), keyed
   * by account id. Missing accounts (never snapshotted) simply do not appear —
   * the trend helper treats that as "no baseline" → SAME.
   */
  async previousRanks(accountIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!accountIds.length) return out;
    const rows = await this.snapshotRepo.find({
      where: { accountId: In(accountIds) },
      select: ['accountId', 'rank'],
    });
    for (const r of rows) out.set(r.accountId, r.rank);
    return out;
  }
}
