import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '@src/user/enums/role.enum';

/**
 * The smallest order VALUE a buyer role may check out with — set by the admin,
 * not by code.
 *
 * Replaces the hard-coded `CART_LIMITS.minQuantity`, and deliberately switches
 * the unit from quantity to value: a warehouse's cost of serving an order comes
 * from the trip and the paperwork, not from how many kilograms it happens to
 * be, so 500 kg of a cheap material and 5 kg of an expensive one are not
 * comparable at all.
 *
 * Two rows in practice — FACTORY and EXTERNAL_PARTNER — with the role UNIQUE so
 * "the minimum for factories" always has exactly one answer.
 */
@Entity('order_minimums')
export class OrderMinimum {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'enum', enum: Role })
  role: Role;

  /**
   * Compared against the GOODS total only. Delivery is a service fee, not
   * merchandise: counting it would let a distant buyer clear the bar that an
   * identical nearby order fails, purely for being far away.
   */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  minOrderValue: string;

  @Column({ default: 'JOD' })
  currency: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
