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

@Entity('collector_profiles')
export class CollectorProfile extends Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column({ nullable: false })
  drivingCretificatePhoto: string;

  @Column({nullable:false})
  birthDate:Date

  @Column(()=>ProfileStatus)
  profile:ProfileStatus

  @OneToOne(() => Account, (account) => account.CollectorProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
