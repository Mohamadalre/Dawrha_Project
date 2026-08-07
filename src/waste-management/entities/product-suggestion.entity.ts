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
import { SuggestionSource } from '../enums/suggestion-source.enum';

@Entity('product_suggestions')
export class ProductSuggestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null for a proposal made by the Odoo administrator, who has no app account. */
  @ManyToOne(() => Account, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account?: Account;

  @Index()
  @Column({ name: 'account_id', nullable: true })
  accountId?: string;

  @Index()
  @Column({ type: 'enum', enum: SuggestionSource, default: SuggestionSource.APP })
  source: SuggestionSource;

  /**
   * The Odoo record this proposal mirrors — UNIQUE, so a retried push after a
   * timeout updates the same row instead of filing the proposal twice.
   */
  @Column({ name: 'odoo_suggestion_id', type: 'int', nullable: true })
  odooSuggestionId?: number;

  /** Who proposed it in Odoo; the only identity available for that side. */
  @Column({ name: 'suggested_by_name', length: 150, nullable: true })
  suggestedByName?: string;

  @Column()
  productName: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @ManyToOne(() => WasteCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category?: WasteCategory;

  @Column({ name: 'category_id', nullable: true })
  categoryId?: string;

  /**
   * A category the proposer says does not exist yet.
   *
   * Kept as TEXT and never auto-created. A new material very often belongs to a
   * category nobody has set up, and without somewhere to say so the proposer has
   * to either file it under a category it does not belong to or not file it at
   * all — both of which lose the information the proposal was made to carry.
   *
   * Creating the category from this string automatically would be worse than
   * losing it: categories are the shape of the whole catalogue, two people would
   * spell the same one differently, and nothing would ever merge them. The
   * reviewer reads the name and decides.
   */
  @Column({ name: 'suggested_category_name', length: 150, nullable: true })
  suggestedCategoryName?: string;

  /**
   * One or more image URLs for the proposed material (uploaded to Cloudinary).
   * A suggestion is a name + a category + at least one picture — no unit, no
   * price, no grades: it is a hint for the admin, not a catalogue row.
   */
  @Column({ name: 'image_urls', type: 'jsonb', nullable: true })
  imageUrls?: string[];

  /** The admin's free-text reply to the proposer (delivered as a notification). */
  @Column({ name: 'admin_notes', type: 'text', nullable: true })
  adminReply?: string;

  /** When the admin replied. */
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  repliedAt?: Date;

  /** Which admin replied. */
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  repliedBy?: string;

  @CreateDateColumn()
  createdAt: Date;
}
