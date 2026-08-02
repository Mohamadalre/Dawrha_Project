import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { DistanceSource } from '../enums/distance-source.enum';

/**
 * Road distance between one buyer and one warehouse.
 *
 * Exists so that placing an order costs ZERO calls to the distance provider.
 * Google's Distance Matrix is billed per origin×destination element, and both
 * endpoints here are effectively static — a factory does not move, and neither
 * does a warehouse — so the same pair would otherwise be re-billed on every
 * single order.
 *
 * Rows are written by a warm-up job when a buyer's location is set (and when a
 * warehouse is added or moved), which is why the order path only ever reads.
 */
@Entity('distance_cache')
@Index(['buyerProfileId', 'warehouseId'], { unique: true })
export class DistanceCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The buyer's profile row. Not a FK: factories and free facilities live in
   * different tables, and the cache is deliberately indifferent to which.
   */
  @Index()
  @Column({ type: 'uuid' })
  buyerProfileId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Index()
  @Column({ name: 'warehouse_id' })
  warehouseId: string;

  @Column({ type: 'decimal', precision: 10, scale: 3 })
  distanceKm: string;

  /** Travel time, kept for future ETA display; not used in pricing. */
  @Column({ type: 'int', nullable: true })
  durationSeconds?: number;

  /**
   * Which method produced this number. Stored rather than inferred so a
   * straight-line fallback is never mistaken for a real road distance — and so
   * the warm-up job can find and upgrade the estimates later.
   */
  @Column({ type: 'enum', enum: DistanceSource })
  source: DistanceSource;

  @UpdateDateColumn()
  computedAt: Date;
}
