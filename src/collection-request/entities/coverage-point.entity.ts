import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';

/**
 * A place idle drivers wait when there is nothing to collect: schools, crowded
 * markets, hospitals. Coverage assignments park drivers on these points at
 * shift start; when a request appears the elected driver leaves his point,
 * serves it, and returns. Points can be static (priority) or dynamic.
 */
@Entity('coverage_points')
@Index(['isActive', 'priority'])
export class CoveragePoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  /** SCHOOL / MARKET / HOSPITAL / GENERAL — display and prioritisation only. */
  @Column({ name: 'point_type', length: 50, default: 'GENERAL' })
  pointType: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  lat: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  lng: string;

  /** Meters around the point a driver is considered "on it". */
  @Column({ name: 'radius_m', type: 'int', default: 1000 })
  radiusM: number;

  /** Higher priority points receive drivers first in rebalancing. */
  @Column({ type: 'smallint', default: 0 })
  priority: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @ManyToOne(() => Warehouse, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse?: Warehouse | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
