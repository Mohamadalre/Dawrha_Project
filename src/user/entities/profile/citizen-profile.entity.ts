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
import { Location } from '@src/user/entities/location/location.entity';


@Entity('citizen_profiles')
export class CitizenProfile  {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @OneToOne(() => Account, (account) => account.citizenProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;


  @OneToOne(() => Location, {
    cascade: true, 
    eager: true,   
  })
  @JoinColumn()
  location: Location;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
