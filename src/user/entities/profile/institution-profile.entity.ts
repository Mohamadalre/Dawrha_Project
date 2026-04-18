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

@Entity('institution_profiles')
export class InstitutionProfile extends Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  institutionName: string;

  @Column()
  institutionManager: string;


  @Column({unique:true,nullable:false})
  CommercialRegistrationNumber: string;

  @OneToOne(() => Account, (account) => account.institutionProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
