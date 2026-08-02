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
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';
import { Product } from './product.entity';

/**
 * A grade that belongs to ONE material.
 *
 * Conditions are per-product, not a global list, because they are not a
 * universal vocabulary: the grades that describe scrap paper say nothing
 * useful about copper. A shared list forces every material to borrow another's
 * words, and pricing then has to carry rows for grades that cannot exist.
 *
 * A material starts with NONE. The admin adds the grades that material actually
 * has, or leaves it ungraded — and "ungraded" is a real, common answer, not a
 * missing setup step. What follows from that choice:
 *
 *   graded   → FACTORY and FREE_FACILITY are priced per grade
 *   ungraded → every role gets one price, factories included
 *
 * They also drive the per-grade stock lines mirrored from Odoo, and are pushed
 * there (SYNC_CONDITION) so the sorting screen offers the right grades for the
 * material in hand.
 */
@Entity('material_conditions')
// The code identifies a grade WITHIN its material: two materials may both have
// a 'GOOD', and they are different grades of different things.
@Unique(['productId', 'code'])
export class MaterialCondition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  /** The material this grade belongs to. */
  @Index()
  @Column({ name: 'product_id' })
  productId: string;

  /** Machine code, unique within the material (e.g. EXCELLENT). */
  @Column({ length: 30 })
  code: string;

  @Column({ length: 100 })
  nameEn: string;

  @Column({ length: 100 })
  nameAr: string;

  /**
   * Position within the material's own grades, best first.
   *
   * Assigned automatically on create (last + 1) rather than taken from the
   * request: an order the caller chooses is an order two callers can collide
   * on. A dedicated reorder route moves a grade to an explicit position and
   * shifts the rest, which is the only place the sequence is rewritten.
   */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  /** Odoo id of the mirrored condition; null until the sync job pushes it. */
  @Column({ type: 'int', nullable: true })
  odooConditionId?: number;

  @Column({ type: 'enum', enum: OdooSyncStatus, default: OdooSyncStatus.PENDING })
  odooSyncStatus: OdooSyncStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Stock mirrored from Odoo before sorting carries this pseudo-condition. */
export const UNGRADED_CONDITION = 'UNGRADED';
