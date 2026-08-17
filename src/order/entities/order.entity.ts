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
 * A cart line frozen onto the order while it waits on the buyer's partial
 * decision. Structurally the allocator's `RequestedLine`, kept here so the
 * entity does not import from a provider.
 */
export interface RequestedLineSnapshot {
  productId: string;
  odooProductId: number;
  productName: string;
  conditionCode: string | null;
  quantity: number;
  unitType: string;
  unitPrice: number;
}

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
   * The buyer chose to CONSOLIDATE a split (non-delivery) order: a delivery
   * truck gathers the far warehouses' parts into the one warehouse nearest the
   * buyer, who then collects everything from that single place. Only ever true
   * for a PICKUP order split across more than one warehouse. Decided AFTER
   * allocation (the split must be known first), never at checkout.
   */
  @Column({ default: false })
  consolidate: boolean;

  /**
   * The gathering point when `consolidate` is true: the order's warehouse
   * nearest the buyer. Its own part stays put — only the farther warehouses'
   * parts are carried to it. Null until consolidation is chosen.
   */
  @Column({ name: 'consolidation_warehouse_id', type: 'uuid', nullable: true })
  consolidationWarehouseId?: string | null;

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

  /**
   * What the buyer asked for, frozen, while the order waits on their decision.
   *
   * When no set of warehouses can cover the order, it parks at
   * NEEDS_CUSTOMER_DECISION — but by then the cart is emptied and no parts
   * exist yet, so there is nowhere left to read the request from. This snapshot
   * is what the decision endpoint re-plans against when the buyer accepts the
   * available quantity. Null at every other time; cleared the moment allocation
   * proceeds.
   */
  @Column({ type: 'jsonb', nullable: true })
  requestedLines?: RequestedLineSnapshot[] | null;

  /** Value of the goods, with prices frozen at checkout. */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  goodsTotal: string;

  /** Sum of the parts' delivery legs; 0 for PICKUP. */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  deliveryTotal: string;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  grandTotal: string;

  @Column({ default: 'SYP' })
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
