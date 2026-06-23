

import {
  Column,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { WarehouseManager }
from './warehouse-manager.entity';

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  code: string;

  @Column()
  odooWarehouseId: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude?: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude?: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ type: 'int', nullable: true })
  capacity?: number;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  currentLoad: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastOdooSync?: Date;

  @OneToOne(
    () => WarehouseManager,
    (manager) => manager.warehouse,
  )
  manager: WarehouseManager;
}