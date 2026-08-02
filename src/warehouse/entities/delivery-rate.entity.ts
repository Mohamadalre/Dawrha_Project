import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The per-kilometre delivery rate, authored by the BACKEND administrator.
 *
 * Deliberately NOT the same table as `delivery_tariffs`. That one is a read-only
 * mirror of what Odoo's administrator authors, and the sync job REPLACES it
 * whole on every change — so a value written there by this backend would vanish
 * the next time anyone touched a tariff in Odoo, silently and with no error to
 * follow. Two authors need two tables; sharing one would mean whichever system
 * wrote last wins, which is not a rule anybody can reason about.
 *
 * Only ONE row is active at a time. Superseded rows are kept rather than
 * updated in place: a delivery quoted last month was quoted at last month's
 * rate, and overwriting the number would make every past quote unexplainable.
 */
@Entity('delivery_rates')
export class DeliveryRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Cost of one kilometre travelled, from the warehouse to the buyer.
   *
   * Decimal, not float: money compared or summed as a float drifts, and this
   * number multiplies a distance before it is ever shown to a customer.
   */
  @Column({ name: 'rate_per_km', type: 'decimal', precision: 12, scale: 3 })
  ratePerKm: string;

  /** Charged once per delivery, before any distance is counted. */
  @Column({ name: 'base_fee', type: 'decimal', precision: 12, scale: 3, default: 0 })
  baseFee: string;

  /**
   * Floor for a single delivery.
   *
   * A very short trip still costs a driver, a vehicle and an hour. Without a
   * floor the nearest buyer is delivered to at a price that does not cover
   * sending anyone at all.
   */
  @Column({ name: 'min_charge', type: 'decimal', precision: 12, scale: 3, default: 0 })
  minCharge: string;

  @Column({ length: 8, default: 'JOD' })
  currency: string;

  /**
   * Exactly one row is active. Enforced by the service rather than by a unique
   * index, because "one active row" is a rule about history: activating a new
   * rate DEACTIVATES the previous one in the same transaction, and both rows
   * survive.
   */
  @Index()
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** When this rate started applying — stamped, never back-dated silently. */
  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom: Date;

  /** Set when a newer rate replaced this one. */
  @Column({ name: 'effective_until', type: 'timestamptz', nullable: true })
  effectiveUntil?: Date | null;

  /** Why the rate changed — fuel, wages, a seasonal decision. */
  @Column({ type: 'text', nullable: true })
  note?: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
