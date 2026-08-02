import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { OrderPart } from './order-part.entity';
import { OrderOfferStatus } from '../enums/order-offer-status.enum';

/**
 * The ledger of who was asked, when, and what they said.
 *
 * This table is what makes reallocation terminate. Rows are NEVER deleted: the
 * allocator builds each new round's candidate list by subtracting every
 * warehouse that already answered no (or failed to answer) for this order, so
 * the same warehouse can never be asked twice and the search strictly shrinks.
 *
 * `expiresAt` closes the other, quieter failure: a manager on leave never
 * clicks anything, and without a deadline the order would wait forever. In
 * practice silence — not refusal — is the more common way an order stalls.
 */
@Entity('order_part_offers')
@Index(['partId', 'roundNumber'])
export class OrderPartOffer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderPart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'part_id' })
  part: OrderPart;

  @Index()
  @Column({ name: 'part_id' })
  partId: string;

  /** Denormalised so the exclusion query needs no join. */
  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Index()
  @Column({ name: 'warehouse_id' })
  warehouseId: string;

  /** Denormalised for the same reason — one indexed lookup per allocation. */
  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'int', default: 1 })
  roundNumber: number;

  @Index()
  @Column({ type: 'enum', enum: OrderOfferStatus, default: OrderOfferStatus.OFFERED })
  status: OrderOfferStatus;

  @Column({ type: 'timestamptz' })
  offeredAt: Date;

  /** Past this instant a cron marks the offer EXPIRED and reallocates. */
  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt?: Date;

  @Column({ type: 'varchar', length: 400, nullable: true })
  rejectReason?: string;

  @CreateDateColumn()
  createdAt: Date;
}
