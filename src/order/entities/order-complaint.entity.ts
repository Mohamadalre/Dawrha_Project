import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { OrderPart } from './order-part.entity';
import {
  ComplaintKind,
  ComplaintRoute,
  ComplaintStatus,
} from '../enums/complaint-kind.enum';

/**
 * A problem the buyer reports about ONE part of their order.
 *
 * Tied to the part, not the order, for the same reason ratings are: in a split
 * order only one warehouse may be at fault, and a complaint against "the order"
 * names nobody. The part identifies the warehouse, the output employee who
 * deducted the goods, and the zone-movement log that says what actually left.
 *
 * `route` is derived from the kind at creation and stored, so a later change to
 * the routing rules cannot silently move complaints that are already being
 * worked on.
 */
@Entity('order_complaints')
@Index(['partId', 'status'])
export class OrderComplaint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderPart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'part_id' })
  part: OrderPart;

  @Index()
  @Column({ name: 'part_id' })
  partId: string;

  /** Denormalised for the buyer's "my complaints" listing. */
  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Index()
  @Column({ name: 'warehouse_id' })
  warehouseId: string;

  @Column({ type: 'enum', enum: ComplaintKind })
  kind: ComplaintKind;

  @Column({ type: 'enum', enum: ComplaintRoute })
  route: ComplaintRoute;

  @Index()
  @Column({ type: 'enum', enum: ComplaintStatus, default: ComplaintStatus.OPEN })
  status: ComplaintStatus;

  @Column({ type: 'varchar', length: 2000 })
  description: string;

  /** Set when a shortage is claimed, so the gap can be checked against Odoo. */
  @Column({ type: 'decimal', precision: 12, scale: 3, nullable: true })
  claimedShortfall?: string;

  /** Pushed to Odoo for warehouse-routed complaints; null for admin ones. */
  @Column({ type: 'int', nullable: true })
  odooComplaintId?: number;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  resolution?: string;

  @Column({ type: 'uuid', nullable: true })
  resolvedBy?: string;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
