import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { CollectionRequest } from './collection-request.entity';
import { ShipmentStatus } from '../enums/shipment-status.enum';

/**
 * A shipment groups multiple collected requests into one warehouse delivery.
 *
 * Flow (auto-created):
 *  - Driver accepts first request → shipment auto-created (CREATED).
 *  - Driver accepts more requests → added to the active shipment.
 *  - Driver starts his tour → shipment auto-departs (IN_TRANSIT).
 *  - All requests collected → route completes → shipment auto-delivered (DELIVERED).
 *  - Driver may also manually deliver via the API.
 *
 * warehouseId is nullable at creation; resolved from the driver's truck handover
 * when the shipment departs or is delivered.
 */
@Entity('shipments')
@Index(['driverId'])
@Index(['truckId'])
@Index(['warehouseId'])
@Index(['status'])
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** SHP-YYYYMMDD-### — unique human-readable number. */
  @Column({ name: 'shipment_number', length: 32, unique: true })
  shipmentNumber: string;

  @Column({
    type: 'enum',
    enum: ShipmentStatus,
    enumName: 'shipment_status',
    default: ShipmentStatus.CREATED,
  })
  status: ShipmentStatus;

  @ManyToOne(() => CollectorProfile, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driver_id' })
  driver: CollectorProfile;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => TruckEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'truck_id' })
  truck: TruckEntity;

  @Column({ name: 'truck_id' })
  truckId: string;

  @ManyToOne(() => Warehouse, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse?: Warehouse | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @Column({
    name: 'total_weight_kg',
    type: 'decimal',
    precision: 12,
    scale: 3,
    default: 0,
  })
  totalWeightKg: string;

  @Column({ name: 'total_requests', type: 'int', default: 0 })
  totalRequests: number;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'collected_at', type: 'timestamptz', nullable: true })
  collectedAt?: Date | null;

  @Column({ name: 'departed_at', type: 'timestamptz', nullable: true })
  departedAt?: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @OneToMany(() => CollectionRequest, (r) => r.shipment)
  requests: CollectionRequest[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
