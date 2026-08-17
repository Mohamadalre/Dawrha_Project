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
import { MeasurementUnit } from './measurement-unit.entity';
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

  /**
   * The material's measurement unit, linked by id exactly like its category.
   *
   * One unit serves many materials; a material has exactly one. The link is
   * `RESTRICT` rather than cascade: deleting a unit must not delete the
   * materials measured in it, and the admin route already refuses to remove a
   * unit that is in use.
   */
  @ManyToOne(() => MeasurementUnit, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unit_id' })
  unit?: MeasurementUnit;

  @Index()
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId?: string;

  /**
   * The same unit's CODE, kept alongside the link.
   *
   * Not redundant: Odoo, the cart lines and the material-suggestion flow all
   * speak in codes ('KG'), and resolving a uuid on every one of those reads
   * would be paying for the link twice. `unitId` is the truth; this is the
   * denormalised label, written from it and never edited on its own.
   */
  @Column({ length: 20, default: 'PIECE' })
  unitType: string;

  /**
   * Weight of ONE unit of this material, in kilograms — the admin's answer,
   * and visible to the admin ALONE.
   *
   * Delivery truck capacity is measured in kilograms, so a material sold by the
   * piece (or any non-kg unit) cannot be loaded onto a route until its weight is
   * known. Null means the material is already measured in kilograms, where one
   * unit IS one kilogram and no conversion is needed. Never surfaced to buyers:
   * it is a logistics figure, not a catalogue one.
   */
  @Column({ name: 'unit_weight_kg', type: 'decimal', precision: 12, scale: 3, nullable: true })
  unitWeightKg?: string | null;

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
