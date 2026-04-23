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

@Entity('institution_profiles')
export class InstitutionProfile extends Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column()
  institutionManager: string;

  @Column({unique:true,nullable:false})
  institutionPhone: string;

  @Column({unique:true,nullable:false})
  CommercialRegistrationNumber: string;

  @Column(()=>ProfileStatus)
  profile:ProfileStatus

  @OneToOne(() => Account, (account) => account.institutionProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
