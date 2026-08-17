import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '@src/user/enums/role.enum';

/**
 * How much money ONE point is worth, per buyer/seller role — the conversion the
 * platform uses to reward a completed order.
 *
 * One rate per role (a factory and an institution may earn at different rates),
 * so a buyer who receives an order worth `amountPerPoint × N` is credited N
 * points. The admin authors it; nothing else writes it.
 *
 * `amountPerPoint` is the money each point stands for (e.g. 1000 SYP = 1 point),
 * kept as decimal because it multiplies an order total before anyone is paid.
 */
@Entity('points_rates')
@Unique(['role'])
export class PointsRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The role this rate applies to — one rate per role. */
  @Column({ type: 'enum', enum: Role })
  role: Role;

  /**
   * The money ONE point represents. An order worth `amountPerPoint × N` earns N
   * points. Must be > 0 — a zero would divide by nothing and mint infinite
   * points.
   */
  @Column({ name: 'amount_per_point', type: 'decimal', precision: 14, scale: 3 })
  amountPerPoint: string;

  /** The currency `amountPerPoint` is quoted in. */
  @Column({ length: 8, default: 'SYP' })
  currency: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
