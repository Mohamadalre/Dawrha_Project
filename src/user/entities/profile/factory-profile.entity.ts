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

@Entity('factory_profiles')
export class FactoryProfile extends Location{
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  factoryManager: string;

  @Column({ unique: true , nullable:false })
  commercialRegister: string;

  @Column({ unique: true , nullable:false })
  factoryRegister: string;

  @Column(()=>ProfileStatus)
  profile:ProfileStatus

  @Column({unique:true,nullable:false})
  factoryPhone: string;

  @OneToOne(() => Account, (account) => account.factoryProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
