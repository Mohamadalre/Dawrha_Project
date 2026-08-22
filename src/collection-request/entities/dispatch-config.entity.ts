import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/** The six weighted factors of a dispatch election, each 0–100. */
export interface DispatchWeights {
  /** Closeness of the driver to the pickup. */
  proximity: number;
  /** How aligned the driver's heading is with the pickup direction. */
  direction: number;
  /** How lightly loaded the driver already is. */
  load: number;
  /** Remaining payload capacity of the driver's truck. */
  vehicle: number;
  /** Urgency of the request's deadline. */
  deadline: number;
  /** Fairness spread across drivers. */
  fairness: number;
}

export const DEFAULT_DISPATCH_WEIGHTS: DispatchWeights = {
  proximity: 30,
  direction: 25,
  load: 20,
  vehicle: 15,
  deadline: 7,
  fairness: 3,
};

/**
 * The single dispatch engine configuration. The unique `singleton` flag makes
 * a second row impossible, exactly like platform settings: every election
 * reads the one row, and the admin's dispatch screen edits it in place.
 */
@Entity('dispatch_config')
@Unique(['singleton'])
export class DispatchConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: true })
  singleton: boolean;

  @Column({ type: 'jsonb', default: DEFAULT_DISPATCH_WEIGHTS })
  weights: DispatchWeights;

  /** Seconds a driver has to accept an offer before it expires. */
  @Column({ name: 'accept_window_sec', type: 'int', default: 300 })
  acceptWindowSec: number;

  /** Minutes before `scheduledAt` a scheduled/plan request enters the queue. */
  @Column({ name: 'scheduled_lead_min', type: 'int', default: 60 })
  scheduledLeadMin: number;

  /** Max time gap between stops for two requests to share one route. */
  @Column({ name: 'route_merge_max_min', type: 'int', default: 15 })
  routeMergeMaxMin: number;

  /** Max distance between stops for two requests to share one route. */
  @Column({ name: 'route_merge_max_km', type: 'decimal', precision: 8, scale: 2, default: 2 })
  routeMergeMaxKm: string;

  /** ± minutes a plan-generated request tolerates around its scheduled time. */
  @Column({ name: 'institution_tolerance_min', type: 'int', default: 20 })
  institutionToleranceMin: number;

  /** Minutes between coverage rebalancing runs. */
  @Column({ name: 'rebalance_min', type: 'int', default: 30 })
  rebalanceMin: number;

  /** Master switch — when false the engine stops electing. */
  @Column({ name: 'is_enabled', default: true })
  isEnabled: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
