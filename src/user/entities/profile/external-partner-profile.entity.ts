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

@Entity('external_partner_profiles')
export class ExternalPartnerProfile extends Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  externalPartnerName: string;

  @Column()
  externalPartnerManager: string;

  @Column({ unique: true , nullable:false })
  commercialRegister: string;



  @OneToOne(() => Account, (account) => account.externalPartnerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
