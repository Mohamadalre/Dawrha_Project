import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CollectionRequest } from './collection-request.entity';

/**
 * One material on a collection request, snapped at creation.
 *
 * `productId` is deliberately a plain column with no foreign key: the row is a
 * historical snapshot that must survive the product being deactivated or
 * deleted from the catalogue. Everything the producer and the warehouse need —
 * name, unit, price, quantity — is denormalised here.
 */
@Entity('collection_request_lines')
@Index(['requestId'])
export class CollectionRequestLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CollectionRequest, (request) => request.lines, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'request_id' })
  request: CollectionRequest;

  @Column({ name: 'request_id' })
  requestId: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'product_name', length: 255 })
  productName: string;

  /** The unit's code ('KG', 'PIECE', ...) — same denormalised label as the catalogue. */
  @Column({ name: 'unit_type', length: 50, default: 'PIECE' })
  unitType: string;

  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  quantity: string;

  /** The producer's selling price for one unit, at creation time. */
  @Column({ name: 'unit_price', type: 'decimal', precision: 14, scale: 2, default: 0 })
  unitPrice: string;

  /** unitPrice × quantity — the producer's expected proceeds for this line. */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  total: string;

  /** Actual quantity received by the driver at pickup (null until collected). */
  @Column({ name: 'actual_quantity', type: 'decimal', precision: 12, scale: 3, nullable: true })
  actualQuantity?: string | null;

  @Column({ length: 255, nullable: true })
  note?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
