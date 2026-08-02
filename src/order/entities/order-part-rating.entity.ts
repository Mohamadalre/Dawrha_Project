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

/**
 * The buyer's verdict on ONE warehouse's share of an order.
 *
 * Per part, never per order — and that is the whole point. In a split order one
 * warehouse may have been excellent and another poor; a single rating for the
 * order averages them into a number that blames nobody and teaches nothing.
 * Rated per part, the scores aggregate into a real performance figure per
 * warehouse, which is something an admin can act on.
 */
@Entity('order_part_ratings')
export class OrderPartRating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** One rating per part — a buyer revises their verdict, they do not stack it. */
  @Index({ unique: true })
  @Column({ name: 'part_id', type: 'uuid' })
  partId: string;

  @ManyToOne(() => OrderPart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'part_id' })
  part: OrderPart;

  /** Denormalised so "how is this warehouse doing?" needs no join. */
  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Index()
  @Column({ name: 'warehouse_id' })
  warehouseId: string;

  @Column({ type: 'smallint' })
  stars: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note?: string;

  @CreateDateColumn()
  createdAt: Date;
}
