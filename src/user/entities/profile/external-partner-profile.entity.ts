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


@Entity('external_partner_profiles')
export class ExternalPartnerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column()
  externalPartnerManager: string;

  @Column({ unique: true, nullable: false })
  externalPartnerPhone: string;

  @Column({ unique: true, nullable: false })
  commercialRegister: string;

  @OneToOne(() => Location, {
    cascade: true, 
    eager: true,   
  })
  @JoinColumn()
  location: Location;


  @OneToOne(() => Account, (account) => account.externalPartnerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
