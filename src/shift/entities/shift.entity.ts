import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Who a shift is meant for — mirrors recycle.shift.shift_type in Odoo. */
export enum ShiftType {
  DRIVER = 'DRIVER',
  WAREHOUSE = 'WAREHOUSE',
}

/**
 * A work shift drivers operate in. Shifts are authored in Odoo and mirrored
 * here; only DRIVER-type shifts are offered to collectors (onboarding /
 * shift-change). The two seeded shifts (Morning / Evening) are a bootstrap.
 */
@Entity('shifts')
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Odoo id of the shift (shifts are authored in Odoo and mirrored here). */
  @Column({ type: 'int', nullable: true, unique: true })
  odooShiftId?: number;

  /**
   * DEPRECATED single-warehouse scope (kept for backward compatibility during
   * the mirror migration). Scoping now uses isGlobal + odooWarehouseIds.
   */
  @Column({ type: 'int', nullable: true })
  odooWarehouseId?: number | null;

  /**
   * True when the shift applies to EVERY warehouse. A global shift is the only
   * kind a not-yet-accepted driver can pick during onboarding (they have no
   * warehouse yet), and it is always available for shift-change requests.
   */
  @Column({ default: false })
  isGlobal: boolean;

  /**
   * Odoo ids of the warehouses a SPECIFIC shift belongs to (empty for a global
   * shift). A driver may request a shift change into a shift that is global OR
   * that includes their own warehouse.
   */
  @Column({ type: 'int', array: true, default: () => "'{}'" })
  odooWarehouseIds: number[];

  @Column({ unique: true })
  name: string;

  @Column({ type: 'enum', enum: ShiftType, default: ShiftType.DRIVER })
  shiftType: ShiftType;

  /**
   * False when the shift was deleted in Odoo but old rows (driver profiles,
   * past requests) still reference it — hidden from every driver-facing list.
   */
  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  /**
   * Grace margin in minutes (mirrors recycle.shift.tolerance in Odoo). Used by
   * the handover crons: a pickup is "missed" only after shift start + tolerance,
   * and a dropoff is "late" only after shift end + tolerance.
   */
  @Column({ type: 'int', default: 0 })
  tolerance: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
