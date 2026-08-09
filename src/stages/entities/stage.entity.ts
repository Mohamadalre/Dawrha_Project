import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A points STAGE (مرحلة) — the band a user is classified into by how many
 * points their wallet holds.
 *
 * A stage owns a NAME, an IMAGE, a manual ORDER (`sortOrder`, kept a contiguous
 * 1..N sequence by the service — reordered on move, closed up on delete), and a
 * points RANGE `[minPoints, maxPoints]` (inclusive). A user falls in the one
 * stage whose range contains their wallet balance; ranges are validated
 * non-overlapping so that "which stage" is always a single answer.
 */
@Entity('stages')
export class Stage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl?: string | null;

  /** Display/rank order — a contiguous 1..N sequence maintained by the service. */
  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;

  /** First point of the band (inclusive). */
  @Column({ name: 'min_points', type: 'int' })
  minPoints: number;

  /** Last point of the band (inclusive). */
  @Column({ name: 'max_points', type: 'int' })
  maxPoints: number;

  /**
   * Whether the stage is live. An inactive stage keeps its place in the order
   * but classifies nobody — a user whose balance falls in its band reports no
   * current stage until it is switched back on.
   */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
