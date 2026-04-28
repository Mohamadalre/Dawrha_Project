import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Account } from '@src/user/entities/account.entity';


@Entity('account_progress')
@Index(['account'], { unique: true }) 
export class AccountProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column()
  accountId: string;

  @Column({ type: 'json', default: [] })
  completedSteps: string[];
}