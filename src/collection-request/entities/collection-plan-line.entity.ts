import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CollectionPlan } from './collection-plan.entity';

/**
 * One material of a collection plan. Like request lines, `productId` is a
 * plain column: the line is a snapshot that must survive catalogue edits.
 *
 * The unique (planId, productId) pair means "fixed materials": saving a plan
 * replaces its lines rather than allowing duplicates of the same product.
 */
@Entity('collection_plan_lines')
@Unique(['planId', 'productId'])
@Index(['planId'])
export class CollectionPlanLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CollectionPlan, (plan) => plan.lines, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_id' })
  plan: CollectionPlan;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ name: 'product_id' })
  productId: string;

  @Column({ name: 'product_name', length: 255 })
  productName: string;

  @Column({ name: 'unit_type', length: 50, default: 'PIECE' })
  unitType: string;

  /** Snapped once at plan creation; the generator copies it to every request. */
  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  quantity: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
