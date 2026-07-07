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
import { Shift } from '@src/shift/entities/shift.entity';
import { TruckEntity } from './truck.entity';
import { ShiftChangeRequestStatus } from '../enums/shift-change-request-status.enum';

/**
 * A driver's request to be (re)assigned to a specific truck on a specific shift.
 * The admin moves it PENDING → PROCESSING, then processes it (which swaps the
 * driver's assignment) → ACCEPTED, or REJECTED with a reason.
 */
@Entity('shift_change_requests')
@Index(['driverId', 'status'])
export class ShiftChangeRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CollectorProfile, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: CollectorProfile;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => TruckEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'truck_id' })
  truck: TruckEntity;

  @Column({ name: 'truck_id' })
  truckId: string;

  @ManyToOne(() => Shift, { nullable: false })
  @JoinColumn({ name: 'shift_id' })
  shift: Shift;

  @Column({ name: 'shift_id' })
  shiftId: string;

  @Column({
    type: 'enum',
    enum: ShiftChangeRequestStatus,
    default: ShiftChangeRequestStatus.PENDING,
  })
  status: ShiftChangeRequestStatus;

  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
