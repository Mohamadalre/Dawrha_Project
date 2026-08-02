import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from '@src/waste-management/entities/product.entity';
import { OrderPart } from './order-part.entity';

/**
 * One material line of one part, with everything the buyer agreed to FROZEN.
 *
 * The cart re-prices itself whenever the admin changes a price; an order must
 * not. Once placed it is a contract, so the unit price, the unit and the
 * product's name are snapshotted here — a later price change, rename, or even
 * deletion of the product cannot rewrite what the buyer was charged.
 */
@Entity('order_part_lines')
export class OrderPartLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderPart, (part) => part.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'part_id' })
  part: OrderPart;

  @Index()
  @Column({ name: 'part_id' })
  partId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Index()
  @Column({ name: 'product_id' })
  productId: string;

  /** Needed to address the same material inside Odoo. */
  @Column({ type: 'int', nullable: true })
  odooProductId?: number;

  /** Snapshot — survives a later rename. */
  @Column({ length: 200 })
  productName: string;

  /**
   * Grade ordered. Null when the material has no conditions, in which case its
   * price is the plain per-tier one.
   */
  @Column({ name: 'condition_code', length: 30, nullable: true, type: 'varchar' })
  conditionCode?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  quantity: string;

  /** Snapshot of the measurement-unit code (e.g. KG). */
  @Column({ length: 20 })
  unitType: string;

  /** Frozen at checkout — never recalculated. */
  @Column({ type: 'decimal', precision: 12, scale: 3 })
  unitPrice: string;

  @Column({ type: 'decimal', precision: 14, scale: 3 })
  subtotal: string;

  @CreateDateColumn()
  createdAt: Date;
}
