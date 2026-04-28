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



@Entity('institution_profiles')
export class InstitutionProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Account, (account) => account.institutionProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column()
  institutionName: string;

  @Column()
  institutionManager: string;

  @Column({ unique: true, nullable: false })
  institutionPhone: string;

  @Column()
  institutionType: string;

  @Column({ unique: true, nullable: false })
  CommercialRegistrationNumber: string;

  @Column({ nullable: true })
  taxNumber?: string;

  @Column()
  institutionSlogan: string;

  @Column({ nullable: true })
  CommercialRegistrationImage: string;

  @OneToOne(() => Location, {
    cascade: true,
    eager: true,
  })
  @JoinColumn()
  location: Location;
  
  @Column()
  wasteType: string;

  @Column()
  averageProduct: string;

  @Column()
  collectOperationNum: string;


  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
