import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { DeliveryTrip } from './delivery-trip.entity';
import { OrderPart } from './order-part.entity';

/**
 * One warehouse call on a trip: which part is collected, and when it was.
 *
 * The stop — not the trip — is where custody changes hands. A trip in progress
 * has some parts aboard and some still on a warehouse floor, and no single
 * field on the trip can say that. It is also the row that answers the question
 * asked after a shortage: who took this part, from where, and at what time.
 *
 * The LEG each stop is charged
 * ────────────────────────────
 * `legDistanceKm` is the distance from THIS stop to the NEXT one — the last
 * stop's leg being the run to the buyer. Charging each part for the leg that
 * departs its own warehouse makes the parts' costs sum to the route exactly,
 * which the alternative (each warehouse's own distance to the buyer) does not:
 * on a milk run those overlap, and the buyer pays for the same road twice.
 */
@Entity('delivery_trip_stops')
// One part is collected once, on one trip. Two rows for one part would mean
// two trucks each believing they are carrying it.
@Unique(['tripId', 'partId'])
export class DeliveryTripStop {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DeliveryTrip, (trip) => trip.stops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id' })
  trip: DeliveryTrip;

  @Index()
  @Column({ name: 'trip_id', type: 'uuid' })
  tripId: string;

  @ManyToOne(() => OrderPart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'part_id' })
  part: OrderPart;

  @Index()
  @Column({ name: 'part_id', type: 'uuid' })
  partId: string;

  @Index()
  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  /** 1-based position on the route. Stop 1 is the farthest warehouse. */
  @Column({ type: 'int' })
  sequence: number;

  /**
   * How far this warehouse is from the BUYER. Not billed — it is what the
   * route is ordered by, and what makes "farthest first" checkable afterwards.
   */
  @Column({ name: 'distance_to_buyer_km', type: 'decimal', precision: 10, scale: 3, default: 0 })
  distanceToBuyerKm: string;

  /** This stop to the next one (or to the buyer, for the last stop). */
  @Column({ name: 'leg_distance_km', type: 'decimal', precision: 10, scale: 3, default: 0 })
  legDistanceKm: string;

  /** The leg's share of the trip cost — the amount charged to this part. */
  @Column({ name: 'leg_cost', type: 'decimal', precision: 12, scale: 3, default: 0 })
  legCost: string;

  /**
   * When the DRIVER confirmed taking the goods. Empty means not yet collected,
   * and that is the only thing that makes a stop outstanding.
   */
  @Column({ name: 'picked_up_at', type: 'timestamptz', nullable: true })
  pickedUpAt?: Date;

  /** What the driver actually took, if it differed from what was prepared. */
  @Column({ name: 'picked_up_note', length: 400, nullable: true })
  pickedUpNote?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
