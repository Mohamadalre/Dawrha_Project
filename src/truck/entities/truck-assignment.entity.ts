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

@Unique('UQ_TRUCK_SHIFT', ['truck', 'shift'])
@Entity({ name: 'truck_assignments' })
export class TruckAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TruckEntity, (truck) => truck.assignments, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'truck_id' })
  truck: TruckEntity;

  @OneToOne(() => CollectorProfile, (driver) => driver.assignment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: CollectorProfile;

  @Column({
    type: 'enum',
    enum: ['morning', 'evening'],
    nullable: false,
  })
  shift: string;

  @Column({ type: 'date' })
  assignedAt: Date;
}
