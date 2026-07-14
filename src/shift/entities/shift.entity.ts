import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A work shift drivers operate in. There are exactly two seeded shifts
 * (Morning / Evening); admins may only edit their name/times, not create new
 * ones. A truck has one driver per shift → at most two drivers.
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

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
