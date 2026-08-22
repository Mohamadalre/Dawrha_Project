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
import { CollectionRequest } from './collection-request.entity';
import { CollectionRequestAssignmentStatus } from '../enums/collection-request-assignment-status.enum';

/**
 * One entry of the dispatch ledger: the engine elected this driver for this
 * request with this score, and the offer either became the acceptance or was
 * settled (rejected / expired / withdrawn).
 *
 * The unique (requestId, driverId) pair keeps the ledger replayable — a driver
 * is never offered the same request twice — and the score column preserves
 * what the election decided, so "why him?" is answerable after the fact.
 */
@Entity('collection_request_assignments')
@Unique(['requestId', 'driverId'])
@Index(['driverId'])
@Index(['status'])
export class CollectionRequestAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CollectionRequest, (request) => request.assignments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'request_id' })
  request: CollectionRequest;

  @Column({ name: 'request_id' })
  requestId: string;

  @ManyToOne(() => CollectorProfile, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driver_id' })
  driver: CollectorProfile;

  @Column({ name: 'driver_id' })
  driverId: string;

  @Column({
    type: 'enum',
    enum: CollectionRequestAssignmentStatus,
    enumName: 'collection_request_assignment_status',
    default: CollectionRequestAssignmentStatus.OFFERED,
  })
  status: CollectionRequestAssignmentStatus;

  /** The election score that won this offer (0–100, highest wins). */
  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  score?: string | null;

  /** Deadline for the driver's accept; lapses to EXPIRED. */
  @Column({ name: 'offer_expires_at', type: 'timestamptz', nullable: true })
  offerExpiresAt?: Date | null;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
