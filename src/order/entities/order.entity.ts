import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { Province } from '@src/user/entities/location/province.entity';
import { Role } from '@src/user/enums/role.enum';
import { OrderStatus } from '../enums/order-status.enum';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import { OrderPart } from './order-part.entity';

/**
 * One order as the buyer sees it — regardless of how many warehouses end up
 * fulfilling it. The per-warehouse work lives in `OrderPart`.
 *
 * `buyerRole` is stored rather than assumed: factories and free facilities
 * behave identically except for delivery, and citizens/institutions will place
 * orders through this same table later. Keeping the role on the row means that
 * addition needs no schema change and no rework of the allocator.
 */
@Entity('orders')
@Index(['buyerAccountId', 'status'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human-facing reference shown to the buyer and in Odoo's chatter. */
  @Index({ unique: true })
  @Column({ length: 32 })
  orderNumber: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buyer_account_id' })
  buyerAccount: Account;

  @Index()
  @Column({ name: 'buyer_account_id' })
  buyerAccountId: string;

  /** FACTORY / EXTERNAL_PARTNER today; CITIZEN / INSTITUTIONS later. */
  @Column({ type: 'enum', enum: Role })
  buyerRole: Role;

  /**
   * The buyer's profile row (factory_profiles / external_partner_profiles).
   * Not a FK — the profile tables differ per role — but it is what the
   * distance cache and the Odoo push key on.
   */
  @Index()
  @Column({ type: 'uuid' })
  buyerProfileId: string;

  /**
   * Snapshot of the buyer's governorate at checkout. Allocation only ever
   * considers warehouses in it, and snapshotting means a buyer who later moves
   * does not silently rewrite the history of an old order.
   */
  @ManyToOne(() => Province, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'province_id' })
  province?: Province;

  @Index()
  @Column({ name: 'province_id', type: 'uuid', nullable: true })
  provinceId?: string;

  @Index()
  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING_ALLOCATION })
  status: OrderStatus;

  @Column({ type: 'enum', enum: FulfilmentMode })
  fulfilmentMode: FulfilmentMode;

  /**
   * The buyer's own answer at checkout to "ship what is available if a little
   * is missing?". Captured once, up front, so a shortfall never has to be
   * resolved by guessing — and a short shipment is never a surprise.
   */
  @Column({ default: false })
  acceptPartialFulfilment: boolean;

  /**
   * How many allocation attempts have been made. Bounded by policy: without a
   * ceiling, a chain of rejections could re-run forever.
   */
  @Column({ type: 'int', default: 0 })
  allocationRound: number;

  /** Value of the goods, with prices frozen at checkout. */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  goodsTotal: string;

  /** Sum of the parts' delivery legs; 0 for PICKUP. */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  deliveryTotal: string;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  grandTotal: string;

  @Column({ default: 'JOD' })
  currency: string;

  @OneToMany(() => OrderPart, (part) => part.order, { cascade: true })
  parts: OrderPart[];

  @Column({ type: 'timestamptz', nullable: true })
  preparingAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date;

  @Column({ type: 'varchar', length: 400, nullable: true })
  cancelReason?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
