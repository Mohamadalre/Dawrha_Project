import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Cart } from './cart.entity';
import { Product } from './product.entity';
import { Offer } from './offer.entity';

@Entity('cart_items')
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart: Cart;

  @Column({ name: 'cart_id' })
  cartId: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id' })
  productId: string;

  @ManyToOne(() => Offer, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'offer_id' })
  offer?: Offer;

  @Column({ name: 'offer_id', nullable: true })
  offerId?: string;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  quantity: string;

  /** Snapshot of the product's unit code at add-time (see `measurement_units`). */
  @Column({ length: 20 })
  unitType: string;

  /**
   * Material condition ordered (FACTORY / FREE_FACILITY buyers pick a grade —
   * their prices are per condition); null for tiers priced product-wide.
   */
  @Column({ name: 'condition_code', length: 30, nullable: true, type: 'varchar' })
  conditionCode?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  unitPrice: string;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  subtotal: string;

  @Column({ default: false })
  isOffer: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
