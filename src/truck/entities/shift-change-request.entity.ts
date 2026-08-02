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
 * A driver's request to CHANGE HIS SHIFT (submitted in the app with a
 * mandatory reason — no truck is picked by the driver). The WAREHOUSE
 * MANAGER decides in Odoo: PENDING → PROCESSING → ACCEPTED (he picks a free
 * truck of the requested shift, which becomes `truckId`) or REJECTED with a
 * reason. The driver may cancel only while PENDING (deletes both sides).
 */
@Entity('shift_change_requests')
@Index(['driverId', 'status'])
export class ShiftChangeRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Odoo id of the mirrored request (the decision is made in Odoo). */
  @Column({ type: 'int', nullable: true, unique: true })
  odooRequestId?: number;

  @ManyToOne(() => CollectorProfile, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: CollectorProfile;

  @Column({ name: 'driver_id' })
  driverId: string;

  /** Truck the manager reserved on approval — empty until ACCEPTED. */
  @ManyToOne(() => TruckEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'truck_id' })
  truck?: TruckEntity | null;

  @Column({ name: 'truck_id', type: 'uuid', nullable: true })
  truckId?: string | null;

  /** The shift the driver wants to MOVE INTO (of his own warehouse). */
  @ManyToOne(() => Shift, { nullable: false })
  @JoinColumn({ name: 'shift_id' })
  shift: Shift;

  @Column({ name: 'shift_id' })
  shiftId: string;

  /** Why the driver wants the change (mandatory at submission). */
  @Column({ type: 'text', nullable: true })
  reason?: string;

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
