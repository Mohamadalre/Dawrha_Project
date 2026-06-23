import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { TruckEntity } from './truck.entity';
import { StopReason } from '../tracking/enums/stop-reason.enum';

/**
 * Persistent record of a truck's last known position at the moment it stopped
 * (manual stop, driver disconnect, or inactivity). Live positions stay in Redis;
 * this table is the durable history written only on stop.
 */
@Entity('truck_location_logs')
export class TruckLocationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TruckEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'truck_id' })
  truck: TruckEntity;

  @Index()
  @Column({ name: 'truck_id' })
  truckId: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  lat: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  lng: string;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  speed?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  heading?: string;

  @Column({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId?: string;

  @Column({ type: 'enum', enum: StopReason })
  reason: StopReason;

  @Column({ type: 'timestamptz' })
  recordedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
