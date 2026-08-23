import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A background sync job that FAILED permanently — it exhausted every retry and
 * will not run again on its own. BullMQ keeps the failed job (removeOnFail is
 * off), but a failed job in Redis is easy to miss and hard to query; this table
 * is the durable, greppable record of what was lost, so it can be inspected and
 * re-driven by hand.
 *
 * The ALERT itself is a structured ERROR log (marker
 * `SYNC_JOB_DEAD_LETTERED`) an external monitor turns into email/Slack — this
 * row is the evidence that log points at.
 *
 * Every column name is spelled explicitly so the table and the entity can never
 * drift over the naming strategy (the mistake that once broke points_rates).
 */
@Entity('dead_letter_jobs')
export class DeadLetterJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The queue the job came from, e.g. 'waste-odoo-sync'. */
  @Column({ name: 'queue', type: 'varchar', length: 120 })
  queue: string;

  /** BullMQ's own job id — enough to find it in Redis for a manual replay. */
  @Index()
  @Column({ name: 'job_id', type: 'varchar', length: 120, nullable: true })
  jobId: string | null;

  /** The job type, e.g. 'push-order-part-to-odoo'. */
  @Index()
  @Column({ name: 'job_name', type: 'varchar', length: 160 })
  jobName: string;

  /** The job's payload — everything needed to understand or re-drive it. */
  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload: unknown;

  /** The final error message that killed it. */
  @Column({ name: 'error', type: 'text', nullable: true })
  error: string | null;

  /** How many attempts were made before giving up. */
  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
