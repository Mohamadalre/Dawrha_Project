import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { CollectionPlanLine } from './collection-plan-line.entity';
import { CollectionPlanFrequency } from '../enums/collection-plan-frequency.enum';

/**
 * An institution's standing collection arrangement: the same materials, the
 * same quantity, on a repeating schedule. The generator cron reads the active
 * plans each morning and produces one ORG_PLAN request per due plan-day, so
 * "every Monday and Thursday at 16:00 we send our waste" is a single row here.
 *
 * One plan per institution (unique accountId): the institution edits its plan
 * in place rather than stacking several. Materials are fixed at creation —
 * changing the plan replaces its lines, never accumulates.
 */
@Entity('collection_plans')
@Unique(['accountId'])
@Index(['isActive'])
export class CollectionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'account_id' })
  accountId: string;

  @Column({ length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: CollectionPlanFrequency,
    enumName: 'collection_plan_frequency',
    default: CollectionPlanFrequency.WEEKLY,
  })
  frequency: CollectionPlanFrequency;

  /** ISO weekdays 1=Monday..7=Sunday — required for WEEKLY. */
  @Column({ type: 'int', array: true, nullable: true })
  weekdays?: number[] | null;

  /** Days of month 1..31 — required for MONTHLY. */
  @Column({ name: 'month_days', type: 'int', array: true, nullable: true })
  monthDays?: number[] | null;

  /** Local time of day the pickup is scheduled, e.g. '16:00:00'. */
  @Column({ name: 'collection_time', type: 'time', default: '10:00:00' })
  collectionTime: string;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate?: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate?: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** A message the driver sees on every request this plan generates. */
  @Column({ name: 'item_note', length: 500, nullable: true })
  itemNote?: string | null;

  /** Last cycle day the generator produced a request for (YYYY-MM-DD). */
  @Column({ name: 'last_generated_date', type: 'date', nullable: true })
  lastGeneratedDate?: string | null;

  @OneToMany(() => CollectionPlanLine, (line) => line.plan, { cascade: true })
  lines: CollectionPlanLine[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
