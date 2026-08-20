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

  @Column({ length: 8, default: 'SYP' })
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

  /**
   * When this rate STOPPED being in force — stamped the moment a newer rate
   * replaced it, whether by setting a new one or by editing this one.
   *
   * This is the whole point of keeping superseded rows: `effective_from` →
   * `effective_until` is the window a rate was actually quoted in, so a delivery
   * priced at any past date can always be explained by the one row whose window
   * contains it. The active row has this null (it has not ended yet); every
   * other row carries the exact instant it was closed.
   */
  @Column({ name: 'effective_until', type: 'timestamptz', nullable: true })
  effectiveUntil?: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
