import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { Product } from './product.entity';

/**
 * A material a buyer wants to find again.
 *
 * Shared by all four buyer roles — citizen, institution, factory, free
 * facility — because it is the same act for every one of them: "this is one of
 * the things I deal in, put it where I can reach it". A table per role would be
 * four schemas, four services and four sets of the same bug.
 *
 * Keyed on the ACCOUNT rather than the profile. The profile is the paperwork of
 * one role and a citizen barely has one; the account is what every buyer has,
 * and it is what the token carries — so the ownership check is a comparison
 * against the signed-in id and never a join.
 *
 * The (account, product) pair is UNIQUE. Favouriting is idempotent by nature:
 * tapping a heart twice on a slow connection must leave one row, not two, and
 * the count on the screen must not depend on how many times a button was
 * pressed while it looked unresponsive.
 */
@Entity('favourites')
@Unique('UQ_favourite_account_product', ['accountId', 'productId'])
export class Favourite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Index()
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  /**
   * CASCADE on purpose: a material that no longer exists cannot be a favourite
   * of anything. Leaving the row would put a dead entry on a buyer's list that
   * they can see and cannot remove.
   */
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /**
   * The buyer's own note — "the grade the Aleppo line takes", "ask for
   * pre-baled". Optional, and the only thing about a favourite that can be
   * EDITED: the material itself is not editable, so without this a favourite
   * would have nothing to update and the idea of editing one would be empty.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
