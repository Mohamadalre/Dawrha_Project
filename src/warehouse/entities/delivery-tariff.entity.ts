import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Province } from '@src/user/entities/location/province.entity';
import { Warehouse } from './warehouse.entity';
import { DeliveryTariffScope } from '../enums/delivery-tariff-scope.enum';

/**
 * Read-only mirror of `recycle.delivery.tariff` in Odoo.
 *
 * The Odoo administrator authors delivery pricing (Odoo owns the fleet, so it
 * owns what a delivery costs). This table exists so a buyer's cart can show a
 * delivery estimate from a plain database read — quoting over RPC would make
 * the checkout screen fail whenever Odoo is briefly unreachable, and a price
 * the buyer sees before committing must never depend on that.
 *
 * Never written by backend business logic: the sync job replaces the whole set
 * on every change, so a local edit would silently disappear.
 */
@Entity('delivery_tariffs')
export class DeliveryTariff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Odoo row id — the match key, so a rescope never creates a duplicate. */
  @Index({ unique: true })
  @Column({ type: 'int' })
  odooTariffId: number;

  @Column({ type: 'enum', enum: DeliveryTariffScope })
  scope: DeliveryTariffScope;

  /** Set only for WAREHOUSE scope. */
  @ManyToOne(() => Warehouse, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse?: Warehouse;

  @Index()
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string;

  /** Set only for PROVINCE scope. */
  @ManyToOne(() => Province, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'province_id' })
  province?: Province;

  @Index()
  @Column({ name: 'province_id', type: 'uuid', nullable: true })
  provinceId?: string;

  /** Charged once per delivery, before distance. */
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  baseFee: string;

  /** Multiplied by the road distance from the warehouse to the buyer. */
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  ratePerKm: string;

  /** Floor for the whole delivery; 0 = no floor. */
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  minFee: string;

  @Column({ default: 'SYP' })
  currency: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  syncedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
