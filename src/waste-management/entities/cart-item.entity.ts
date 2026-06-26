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
import { UnitType } from '../enums/unit-type.enum';

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

  @Column({ type: 'enum', enum: UnitType })
  unitType: UnitType;

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
