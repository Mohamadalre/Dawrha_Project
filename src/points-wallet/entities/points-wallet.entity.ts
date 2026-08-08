import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '@src/user/entities/account.entity';

/**
 * A points wallet — one per ACTIVE buyer/seller account.
 *
 * It exists so future order flows have somewhere to accrue points: completing an
 * order will raise `points`. It is created empty (0) the moment an account
 * becomes ACTIVE, and only for the roles that actually trade — citizens,
 * institutions, factories and free facilities. An admin never trades, so an
 * admin has no wallet; a not-yet-active account has none either (the wallet
 * appears exactly when the account starts being able to use the platform).
 */
@Entity('points_wallets')
export class PointsWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The owning account. Unique: one wallet per account. Cascade-deleted with the
   * account, so a removed account never leaves an orphaned wallet behind.
   */
  @OneToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Index({ unique: true })
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  /**
   * The balance. Starts at 0 and is only ever raised by the platform (orders),
   * never written directly by the account holder — the view route is read-only.
   */
  @Column({ type: 'int', default: 0 })
  points: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
