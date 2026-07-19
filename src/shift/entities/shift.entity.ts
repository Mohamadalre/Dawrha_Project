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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
