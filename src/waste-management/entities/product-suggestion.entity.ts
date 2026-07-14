import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { WasteCategory } from './waste-category.entity';
import { SuggestionStatus } from '../enums/suggestion-status.enum';

@Entity('product_suggestions')
export class ProductSuggestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Index()
  @Column({ name: 'account_id' })
  accountId: string;

  @Column()
  productName: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @ManyToOne(() => WasteCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category?: WasteCategory;

  @Column({ name: 'category_id', nullable: true })
  categoryId?: string;

  /** Suggested measurement-unit code (see `measurement_units`). */
  @Column({ length: 20 })
  unitType: string;

  @Column({ type: 'decimal', precision: 12, scale: 3, nullable: true })
  estimatedPrice?: string;

  @Column({ nullable: true })
  imageURL?: string;

  @Index()
  @Column({ type: 'enum', enum: SuggestionStatus, default: SuggestionStatus.PENDING_REVIEW })
  status: SuggestionStatus;

  @Column({ type: 'text', nullable: true })
  adminNotes?: string;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy?: string;

  @CreateDateColumn()
  createdAt: Date;
}
