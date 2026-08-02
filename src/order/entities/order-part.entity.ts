import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { OrderPartStatus } from '../enums/order-part-status.enum';
import { Order } from './order.entity';
import { OrderPartLine } from './order-part-line.entity';

/**
 * One warehouse's share of an order — and the unit that maps 1:1 onto a
 * `recycle.order` in Odoo.
 *
 * That mapping is the reason splitting needed no change to Odoo at all:
 * `recycle.order` is already bound to a single warehouse, so a three-way split
 * is simply three of them, each with its own manager, output employee and
 * invoice, reassembled here into the one order the buyer sees.
 */
@Entity('order_parts')
@Index(['orderId', 'warehouseId'])
export class OrderPart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.parts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column({ name: 'order_id' })
  orderId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Index()
  @Column({ name: 'warehouse_id' })
  warehouseId: string;

  /** 1-based, so the buyer can be told "part 2 of 3". */
  @Column({ type: 'int', default: 1 })
  sequence: number;

  @Index()
  @Column({ type: 'enum', enum: OrderPartStatus, default: OrderPartStatus.OFFERED })
  status: OrderPartStatus;

  /** The mirrored `recycle.order`; null until the push job has created it. */
  @Index()
  @Column({ type: 'int', nullable: true })
  odooOrderId?: number;

  /**
   * True while Odoo holds a stock reservation for this part. Mirrors
   * `recycle.order.stock_reserved` so the release is driven from one side only
   * and can never be issued twice.
   */
  @Column({ default: false })
  stockReserved: boolean;

  /** Road distance warehouse → buyer, from the distance cache. */
  @Column({ type: 'decimal', precision: 10, scale: 3, default: 0 })
  distanceKm: string;

  /** This leg's delivery charge; 0 for PICKUP orders. */
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  deliveryCost: string;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  goodsTotal: string;

  @OneToMany(() => OrderPartLine, (line) => line.part, { cascade: true })
  lines: OrderPartLine[];

  // ── Mirrored from Odoo as the warehouse works ──
  @Column({ type: 'varchar', length: 64, nullable: true })
  invoiceNumber?: string;

  @Column({ type: 'timestamptz', nullable: true })
  stockDeductedAt?: Date;

  /** Output zone the manager attested the goods reached. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  outputZoneName?: string;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt?: Date;

  // ── Backend-side, after the goods leave Odoo ──
  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt?: Date;

  @Column({ type: 'varchar', length: 400, nullable: true })
  rejectReason?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
