import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { TruckEntity } from './truck.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { Shift } from '@src/shift/entities/shift.entity';

/** One driver per (truck, shift). The "kasr" assignment table. */
@Unique('UQ_TRUCK_SHIFT', ['truck', 'shift'])
@Entity({ name: 'truck_assignments' })
export class TruckAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Odoo id of the assignment (driver-truck links are decided in Odoo). */
  @Column({ type: 'int', nullable: true, unique: true })
  odooAssignmentId?: number;

  @ManyToOne(() => TruckEntity, (truck) => truck.assignments, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'truck_id' })
  truck: TruckEntity;

  @Column({ name: 'truck_id' })
  truckId: string;

  @OneToOne(() => CollectorProfile, (driver) => driver.assignment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: CollectorProfile;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => Shift, { nullable: false })
  @JoinColumn({ name: 'shift_id' })
  shift: Shift;

  @Column({ name: 'shift_id' })
  shiftId: string;

  @Column({ type: 'timestamptz' })
  assignedAt: Date;
}
