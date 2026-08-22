import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { CoveragePoint } from './coverage-point.entity';

/**
 * Which coverage point a driver is parked at right now.
 *
 * One row per driver (unique driverId): when the driver executes a request he
 * leaves the point, and the rebalancer moves him to a new point afterwards —
 * always by updating this single row, never by stacking.
 */
@Entity('driver_coverage_assignments')
@Unique(['driverId'])
@Index(['coveragePointId'])
export class DriverCoverageAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CollectorProfile, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: CollectorProfile;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => CoveragePoint, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coverage_point_id' })
  coveragePoint: CoveragePoint;

  @Column({ name: 'coverage_point_id' })
  coveragePointId: string;

  @Column({ name: 'assigned_from', type: 'timestamptz', nullable: true })
  assignedFrom?: Date | null;

  @Column({ name: 'assigned_until', type: 'timestamptz', nullable: true })
  assignedUntil?: Date | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
