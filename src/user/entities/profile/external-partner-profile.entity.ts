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
import { LocationBase } from '@src/common/entities/location-base.entity';



@Entity('external_partner_profiles')
export class ExternalPartnerProfile extends LocationBase{
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column()
  externalPartnerName: string;

  @Column({ unique: true, nullable: false })
  externalPartnerPhone: string;

  @Column()
 externalPartnerSlogo: string;

  @Column()
  wasteType: string;
  @Column()
  demandEstimate: string;
  @OneToOne(() => Account, (account) => account.externalPartnerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
