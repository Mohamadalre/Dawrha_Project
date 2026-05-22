

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

  @OneToOne(
    () => WarehouseManager,
    (manager) => manager.warehouse,
  )
  manager: WarehouseManager;
}