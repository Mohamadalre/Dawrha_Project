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
import { TruckEntity } from './truck.entity';
import { Shift } from '@src/shift/entities/shift.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { HandoverStatus } from '../enums/handover-status.enum';

/**
 * A driver's truck custody session for one shift on one day: he picks up the
 * truck (OPEN) and later hands it back (CLOSED). No QR / no GPS — just two
 * timestamped buttons, guarded by the shift window. Mirrored to Odoo where the
 * warehouse manager reads it in "Driver Attendance" (view only).
 *
 * The unique (driver, shift, workDate) row also serves as the once-only guard
 * for the missed-pickup / late-dropoff notifications.
 */
@Entity('truck_handovers')
@Unique(['driverId', 'shiftId', 'workDate'])
@Index(['truckId', 'status'])
export class TruckHandover {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Odoo id of the mirrored handover row. */
  @Column({ type: 'int', nullable: true, unique: true })
  odooHandoverId?: number | null;

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

  @ManyToOne(() => Warehouse, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse?: Warehouse | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null;

  /** The shift day (YYYY-MM-DD) — pickup and dropoff are the same day. */
  @Column({ name: 'work_date', type: 'date' })
  workDate: string;

  /** When the driver pressed "Pick up". Null on a MISSED_PICKUP marker row. */
  @Column({ name: 'picked_up_at', type: 'timestamptz', nullable: true })
  pickedUpAt?: Date | null;

  /** When he pressed "Hand over". */
  @Column({ name: 'dropped_off_at', type: 'timestamptz', nullable: true })
  droppedOffAt?: Date | null;

  /** Notes he must record before handing the truck back. */
  @Column({ name: 'dropoff_reason', type: 'text', nullable: true })
  dropoffReason?: string | null;

  /** Minutes past shift end at dropoff (0 when on time / within tolerance). */
  @Column({ name: 'late_dropoff_minutes', type: 'int', nullable: true })
  lateDropoffMinutes?: number | null;

  @Column({ type: 'enum', enum: HandoverStatus, default: HandoverStatus.OPEN })
  status: HandoverStatus;

  /** Set once when the missed-pickup alert fired (idempotency guard). */
  @Column({ name: 'missed_pickup_notified_at', type: 'timestamptz', nullable: true })
  missedPickupNotifiedAt?: Date | null;

  /** Set once when the late-dropoff alert fired (idempotency guard). */
  @Column({ name: 'late_dropoff_notified_at', type: 'timestamptz', nullable: true })
  lateDropoffNotifiedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
