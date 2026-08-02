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
import { Order } from './order.entity';
import { DeliveryTripStop } from './delivery-trip-stop.entity';
import { DeliveryTripStatus } from '../enums/delivery-trip-status.enum';

/**
 * One truck's run: collect the parts of an order, end at the buyer.
 *
 * A split order sits in several warehouses at once. Sending a separate van to
 * each is the obvious design and the wrong one — it bills the buyer for three
 * journeys down largely the same road, and it needs three drivers for one
 * delivery. So a trip is a MILK RUN: the truck starts at the warehouse
 * FARTHEST from the buyer, calls at the nearer ones on the way in, and arrives
 * at the buyer with the whole order aboard.
 *
 * Which warehouse owns the truck
 * ──────────────────────────────
 * The FIRST stop's. A delivery driver and their truck belong to one warehouse,
 * and a route that crosses warehouses has to start somewhere; starting where
 * the truck already is means no empty positioning leg. That warehouse is
 * recorded as `originWarehouseId` so the cost and the responsibility have an
 * owner.
 *
 * More than one truck
 * ───────────────────
 * When the load exceeds what one truck can carry, the order gets more than one
 * trip, each with its own stops and its OWN distance and cost. Nothing here
 * assumes a single trip per order.
 */
@Entity('delivery_trips')
export class DeliveryTrip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  /** Human reference the driver and the buyer both quote. */
  @Column({ length: 32, unique: true })
  tripNumber: string;

  /**
   * The warehouse whose truck and driver run this trip — the first stop.
   * Kept as a plain id: warehouses are mirrored from Odoo and a hard relation
   * would make a trip undeletable behind a warehouse that is being retired.
   */
  @Index()
  @Column({ name: 'origin_warehouse_id', type: 'uuid' })
  originWarehouseId: string;

  /** Odoo ids of the assigned vehicle and driver, filled when dispatched. */
  @Column({ name: 'odoo_truck_id', type: 'int', nullable: true })
  odooTruckId?: number;

  @Column({ name: 'odoo_driver_id', type: 'int', nullable: true })
  odooDriverId?: number;

  @Column({ length: 160, nullable: true })
  driverName?: string;

  @Column({ length: 32, nullable: true })
  driverPhone?: string;

  @Column({
    type: 'enum',
    enum: DeliveryTripStatus,
    default: DeliveryTripStatus.PLANNED,
  })
  status: DeliveryTripStatus;

  /**
   * The distance the truck actually drives: stop → stop → … → buyer.
   *
   * NOT the sum of each warehouse's distance to the buyer. On a milk run those
   * legs overlap heavily — three warehouses 40, 25 and 10 km out sum to 75 km
   * for a road the truck covers in about 45 — and billing the sum charges the
   * buyer up to twice for the same tarmac. The route length is what the truck
   * burned and what the buyer can be shown.
   */
  @Column({ name: 'route_distance_km', type: 'decimal', precision: 10, scale: 3, default: 0 })
  routeDistanceKm: string;

  /** `routeDistanceKm × rate + base fee`, taken at the moment of quoting. */
  @Column({ name: 'delivery_cost', type: 'decimal', precision: 12, scale: 3, default: 0 })
  deliveryCost: string;

  /**
   * The per-kilometre rate this trip was quoted at, copied not referenced.
   *
   * The admin can change the rate tomorrow; a trip quoted today was quoted at
   * today's rate, and a buyer asking why they paid what they paid must get an
   * answer that does not change afterwards.
   */
  @Column({ name: 'rate_per_km', type: 'decimal', precision: 12, scale: 3, default: 0 })
  ratePerKm: string;

  @Column({ name: 'base_fee', type: 'decimal', precision: 12, scale: 3, default: 0 })
  baseFee: string;

  @Column({ length: 8, default: 'SYP' })
  currency: string;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @OneToMany(() => DeliveryTripStop, (stop) => stop.trip, { cascade: true })
  stops: DeliveryTripStop[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
