
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Warehouse }
from './warehouse.entity';

@Entity('warehouse_managers')
export class WarehouseManager {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  fullName: string;

  @Column({
    unique: true,
  })
  email: string;

  @Column()
  phone: string;

  @Column()
  odooUserId: number;

  @OneToOne(
    () => Warehouse,
    (warehouse) => warehouse.manager,
  )

  @JoinColumn()
  warehouse: Warehouse;
}