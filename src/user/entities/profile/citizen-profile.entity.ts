import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { Location } from '@src/common/entities/location.entity';
import { ProfileStatus } from './profile-status.entity';

@Entity('citizen_profiles')
export class CitizenProfile extends Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column(()=>ProfileStatus)
  profile:ProfileStatus

  @OneToOne(() => Account, (account) => account.citizenProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
