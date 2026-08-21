import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The last recorded leaderboard position of one citizen — the BASELINE the trend
 * (↑ up / ↓ down / = same) is measured against.
 *
 * One row per account (the account id is unique): a daily cron recomputes every
 * active citizen's rank the same way the leaderboard orders them and UPSERTS it
 * here. So this table always holds "where each user stood at the last snapshot",
 * and the live leaderboard compares the current rank to it.
 *
 * Rank is stored, not just points, because points only ever rise — a user can
 * only fall in the standings by being OVERTAKEN, which is a rank change with no
 * points change. Trend is therefore a rank comparison, not a points one.
 */
@Entity('leaderboard_snapshots')
export class LeaderboardSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The citizen this baseline belongs to. Unique — one baseline per account. */
  @Index({ unique: true })
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  /** The 1-based leaderboard position at the snapshot (lower = better). */
  @Column({ type: 'int' })
  rank: number;

  /** The points balance at the snapshot — kept for auditing/derived deltas. */
  @Column({ type: 'int' })
  points: number;

  /** When this baseline was taken (the last daily snapshot). */
  @Column({ name: 'taken_at', type: 'timestamptz' })
  takenAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
