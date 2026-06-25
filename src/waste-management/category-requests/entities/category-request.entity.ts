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
import { Role } from '@src/user/enums/role.enum';
import { CategoryRequestStatus } from '../enums/category-request-status.enum';

/**
 * A request by a commercial account (institution / factory / free facility) to
 * add one or more waste categories to the ones it already holds. Reviewed by an
 * admin; on approval the categories are linked to the account's material.
 */
@Entity('category_requests')
export class CategoryRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Index()
  @Column({ name: 'account_id' })
  accountId: string;

  @Column({ type: 'enum', enum: Role })
  role: Role;

  /** The newly requested category IDs (not yet assigned to the account). */
  @Column({ type: 'uuid', array: true })
  categoryIds: string[];

  @Index()
  @Column({ type: 'enum', enum: CategoryRequestStatus, default: CategoryRequestStatus.PENDING })
  status: CategoryRequestStatus;

  @Column({ type: 'text', nullable: true })
  adminReason?: string;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy?: string;

  @CreateDateColumn()
  createdAt: Date;
}
