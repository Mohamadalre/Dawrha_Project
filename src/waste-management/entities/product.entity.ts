import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { WasteCategory } from './waste-category.entity';
import { ProductPricing } from './product-pricing.entity';
import { Offer } from './offer.entity';
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @ManyToOne(() => WasteCategory, (category) => category.products, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'category_id' })
  category: WasteCategory;

  @Index()
  @Column({ name: 'category_id' })
  categoryId: string;

  @Column({ nullable: true })
  imageURL?: string;

  /** Measurement-unit code — validated against the admin-managed `measurement_units` table. */
  @Column({ length: 20, default: 'PIECE' })
  unitType: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', nullable: true })
  odooProductId?: number;

  @Column({ type: 'enum', enum: OdooSyncStatus, default: OdooSyncStatus.PENDING })
  odooSyncStatus: OdooSyncStatus;

  @OneToMany(() => ProductPricing, (pricing) => pricing.product)
  prices: ProductPricing[];

  @OneToMany(() => Offer, (offer) => offer.product)
  offers: Offer[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
