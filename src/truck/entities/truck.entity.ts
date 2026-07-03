import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TruckAssignmentEntity } from './truck-assignment.entity';
import { TruckStatus } from '../enums/truck-status.enum';

@Entity({ name: 'trucks' })
export class TruckEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  model: string;

  @Column()
  year: number;

  @Column({ unique: true })
  plateNumber: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  maxPayloadKg: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  lengthM: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  widthM: number;

  @Column({ nullable: true })
  drivingLicenseImageUrl: string;

  @Column({ nullable: true })
  mechanicsImageUrl: string;

  @Column({ nullable: true })
  truckWithPlateImageUrl: string;

  @Column({
    type: 'enum',
    enum: TruckStatus,
    default: TruckStatus.ACTIVE,
  })
  status: TruckStatus;

  @OneToMany(() => TruckAssignmentEntity, (assignment) => assignment.truck)
  assignments: TruckAssignmentEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
