import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';

/**
 * A driver's truck-problem report: a mandatory free-text reason plus optional
 * photos (Cloudinary URLs). Mirrored to Odoo (recycle.truck.problem) where the
 * driver's warehouse manager READS it — no decision flows back.
 */
@Entity('truck_problems')
@Index(['driverId'])
export class TruckProblem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Odoo id of the mirrored problem report. */
  @Column({ type: 'int', nullable: true, unique: true })
  odooProblemId?: number | null;

  @ManyToOne(() => CollectorProfile, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: CollectorProfile;

  @Column({ name: 'driver_id' })
  driverId: string;

  @Column({ type: 'text' })
  reason: string;

  /** Uploaded photo URLs (0..n). */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  images: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
