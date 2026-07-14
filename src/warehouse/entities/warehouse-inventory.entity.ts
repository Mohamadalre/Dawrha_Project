import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { Warehouse } from './warehouse.entity';

@Entity('warehouse_inventory')
@Unique(['warehouseId', 'odooProductId', 'conditionCode'])
export class WarehouseInventory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Index()
  @Column({ name: 'warehouse_id' })
  warehouseId: string;

  @Column({ type: 'int', nullable: true })
  odooProductId?: number;

  /**
   * Material condition (grade) assigned by the Odoo sorter for this quantity;
   * UNGRADED = stock that has not been sorted yet.
   */
  @Column({ name: 'condition_code', length: 30, default: 'UNGRADED' })
  conditionCode: string;

  @Column({ nullable: true })
  productName?: string;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  quantity: string;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  reservedQuantity: string;

  @Column({ type: 'int', default: 0 })
  reorderLevel: number;

  @Column({ type: 'timestamptz', nullable: true })
  syncedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
