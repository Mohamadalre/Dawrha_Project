import {
  Column,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { WarehouseManager } from './warehouse-manager.entity';

/** A zone the warehouse is divided into (mirrors a recycle.zone in Odoo). */
export interface WarehouseZone {
  name: string;
  type: string;
}

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  code: string;

  /**
   * Odoo id of the mirrored recycle.warehouse. Null until the create job has
   * pushed this backend-created warehouse to Odoo.
   */
  @Column({ type: 'int', nullable: true })
  odooWarehouseId?: number;

  @Column({ type: 'enum', enum: OdooSyncStatus, default: OdooSyncStatus.PENDING })
  odooSyncStatus: OdooSyncStatus;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude?: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude?: string;

  @Column({ nullable: true })
  address?: string;

  /** Zones the warehouse is split into, pushed to Odoo on creation. */
  @Column({ type: 'jsonb', nullable: true })
  zones?: WarehouseZone[];

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
