import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { Province } from '@src/user/entities/location/province.entity';
import { WarehouseState } from '../enums/warehouse-state.enum';
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

  /**
   * Governorate NAME, kept as the human label shown in listings and as what
   * travels to Odoo on creation. `provinceId` below is the queryable link.
   */
  @Column({ length: 100, nullable: true })
  governorate?: string;

  /**
   * The governorate as a real row of `provinces` — the same table Odoo mirrors
   * as `recycle.province`. Order allocation matches a buyer to warehouses by
   * this id, never by comparing the free-text name.
   */
  @ManyToOne(() => Province, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'province_id' })
  province?: Province;

  @Index()
  @Column({ name: 'province_id', type: 'uuid', nullable: true })
  provinceId?: string;

  /**
   * Lifecycle mirrored from Odoo (`recycle.warehouse.state`), which owns it:
   *   active   — normal
   *   closing  — no new intake; existing stock still ships out
   *   inactive — fully stopped
   * Allocation may only choose ACTIVE warehouses: sending a new order to one
   * that is winding down is precisely what the closing state exists to prevent.
   */
  @Column({
    type: 'enum',
    enum: WarehouseState,
    default: WarehouseState.ACTIVE,
  })
  state: WarehouseState;

  /** Zones the warehouse is split into, pushed to Odoo on creation. */
  @Column({ type: 'jsonb', nullable: true })
  zones?: WarehouseZone[];

  @Column({ type: 'int', nullable: true })
  capacity?: number;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  currentLoad: string;

  /**
   * How many incoming shipments this site has handled, mirrored from Odoo.
   *
   * Held here rather than counted, because shipments do not exist on this side
   * at all: a shipment is a collector's delivery being received, weighed and
   * sorted, and every one of those steps happens in Odoo. Asking Odoo for the
   * number on every read would put a JSON-RPC round trip inside a listing that
   * already answers from one query — so it travels with the rest of the mirror
   * and is refreshed by the same sync.
   */
  @Column({ type: 'int', default: 0 })
  shipmentCount: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastOdooSync?: Date;

  /**
   * When this warehouse was added.
   *
   * The listing orders by it — newest first, because the warehouse an admin is
   * looking for is almost always the one just created, and alphabetical order
   * buries it at whatever letter it happens to start with. The table had no
   * timestamp at all, so "most recent" was not a question it could answer.
   */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(
    () => WarehouseManager,
    (manager) => manager.warehouse,
  )
  manager: WarehouseManager;
}
