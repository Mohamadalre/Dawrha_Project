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

@Entity('external_partner_profiles')
export class ExternalPartnerProfile extends Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column()
  externalPartnerManager: string;

  @Column({unique:true,nullable:false})
  externalPartnerPhone: string;

  @Column({ unique: true , nullable:false })
  commercialRegister: string;

  @Column(()=>ProfileStatus)
  profile:ProfileStatus


  @OneToOne(() => Account, (account) => account.externalPartnerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
