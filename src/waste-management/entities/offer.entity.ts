import {
  Column,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('offers')
export class Offer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (product) => product.offers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Index()
  @Column({ name: 'product_id' })
  productId: string;

  /**
   * Buyer roles the offer is visible to (e.g. only CITIZEN, or only
   * INSTITUTIONS); null/empty = visible to every buyer role.
   */
  @Column({ name: 'target_roles', type: 'text', array: true, nullable: true })
  targetRoles?: string[] | null;

  /**
   * Material condition the offer applies to (graded buyers: factory /
   * free-facility); null = the offer is condition-agnostic.
   */
  @Column({ name: 'condition_code', length: 30, nullable: true, type: 'varchar' })
  conditionCode?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  offerPrice: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  discountPercentage: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  validFrom: Date;

  @Column({ type: 'timestamptz', nullable: true })
  validUntil?: Date;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
