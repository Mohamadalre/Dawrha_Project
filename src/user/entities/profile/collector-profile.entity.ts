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


@Entity('collector_profiles')
export class CollectorProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column({ nullable: false })
  drivingCretificatePhoto: string;

  @Column({ nullable: false })
  birthDate: Date

  @OneToOne(() => Location, {
    cascade: true, 
    eager: true,   
  })
  @JoinColumn()
  location: Location;

  @OneToOne(() => Account, (account) => account.CollectorProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
