import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { SpendingCapPeriod } from '../enums/spending-cap-period.enum';

/**
 * The most a buyer role may SPEND on orders within a rolling window — the upper
 * bound that sits opposite {@link OrderMinimum}'s lower one.
 *
 * Measured in order VALUE, not quantity, and against the goods total only: the
 * same reasoning as the minimum. A distant buyer's delivery fee is a service
 * cost, not spend on merchandise, so counting it would let geography move the
 * ceiling.
 *
 * Role is UNIQUE by design — "the cap for factories" is a single fact — exactly
 * like the minimum table, so the two read and write the same way.
 */
@Entity('order_spending_caps')
export class OrderSpendingCap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'enum', enum: Role })
  role: Role;

  /** The ceiling on goods spend within one {@link period}. */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  maxAmount: string;

  @Column({ type: 'enum', enum: SpendingCapPeriod, default: SpendingCapPeriod.MONTHLY })
  period: SpendingCapPeriod;

  @Column({ default: 'JOD' })
  currency: string;

  /**
   * false = the cap exists but is not enforced. An admin who has not switched a
   * role on has not decided to limit it; a missing/inactive cap means "no
   * ceiling", never "block everything" — the same default as the minimum.
   */
  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
