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
import { MaterialCondition } from './material-condition.entity';
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

  /**
   * The grade this price applies to, BY ID.
   *
   * Added because the code alone could not identify one: a grade code is
   * unique only within its material, so `'GOOD'` names a different grade for
   * scrap paper than for copper, and a price row carrying only the string had
   * nothing a client could act on. Renaming or re-coding a grade also left
   * every price row pointing at a code that no longer existed.
   *
   * NULL for a material with NO grades — which is a real and common answer,
   * not a missing setup step — and for the INDIVIDUAL and COMPANY tiers, which
   * are priced per material rather than per grade.
   */
  @ManyToOne(() => MaterialCondition, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'condition_id' })
  condition?: MaterialCondition | null;

  @Index()
  @Column({ name: 'condition_id', type: 'uuid', nullable: true })
  conditionId?: string | null;

  /**
   * The same grade's CODE, kept alongside the link.
   *
   * Not redundant: Odoo mirrors stock lines by code and the cart carries one,
   * so resolving a uuid on every such read would pay for the link twice.
   * `conditionId` is the truth; this is the denormalised label written from it.
   */
  @Column({ name: 'condition_code', length: 30, nullable: true, type: 'varchar' })
  conditionCode?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  price: string;

  @Column({ default: 'SYP' })
  currency: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  effectiveFrom: Date;

  @Column({ type: 'timestamptz', nullable: true })
  effectiveUntil?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
