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

@Entity('product_pricing')
@Index(['productId', 'tier'])
export class ProductPricing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (product) => product.prices, { onDelete: 'CASCADE' })
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

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  effectiveFrom: Date;

  @Column({ type: 'timestamptz', nullable: true })
  effectiveUntil?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
