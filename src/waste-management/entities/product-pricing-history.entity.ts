import {
  Column,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';
import { PricingTier } from '../enums/pricing-tier.enum';
import { PricingArchiveReason } from '../enums/pricing-archive-reason.enum';

/**
 * Archive of previous (no-longer-active) tier prices. A row lands here whenever
 * the live price in `product_pricing` is replaced or the list is deleted, so the
 * live table only ever holds the current price per tier while the full history
 * is preserved here for the admin to review.
 */
@Entity('product_pricing_history')
@Index(['productId', 'tier'])
export class ProductPricingHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ type: 'enum', enum: PricingTier })
  tier: PricingTier;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  price: string;

  @Column({ default: 'JOD' })
  currency: string;

  /** When this price originally became effective. */
  @Column({ type: 'timestamptz' })
  effectiveFrom: Date;

  /** When it was archived (i.e. replaced or the list deleted). */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  archivedAt: Date;

  @Column({ type: 'enum', enum: PricingArchiveReason })
  archivedReason: PricingArchiveReason;

  /** Admin who triggered the archive (nullable for system actions). */
  @Column({ type: 'uuid', nullable: true })
  archivedBy?: string;

  @CreateDateColumn()
  createdAt: Date;
}
