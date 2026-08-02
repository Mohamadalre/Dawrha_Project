import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { LocationBase } from '@src/common/entities/location-base.entity';
import { Shift } from '@src/shift/entities/shift.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';


@Entity('collector_profiles')
export class CollectorProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @OneToOne(() => Account, (account) => account.CollectorProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ unique: true, nullable: false })
  NationalID: string;

  @ManyToOne(() => Shift, { nullable: false })
  @JoinColumn({ name: 'shift_id' })
  shift: Shift;

  @Column({ name: 'shift_id' })
  shiftId: string;

  /**
   * Warehouse the Odoo admin assigned this driver to on acceptance (mirrored
   * from the driver-decision webhook's warehouse_odoo_id). Scopes which
   * shifts the driver may request a change into.
   */
  @ManyToOne(() => Warehouse, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse?: Warehouse | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @OneToOne(() => TruckAssignmentEntity, (assignment) => assignment.driver)
  assignment: TruckAssignmentEntity;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
