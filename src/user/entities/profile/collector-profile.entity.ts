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
import { Shift } from '@src/user/enums/shift.enum';


@Entity('collector_profiles')
export class CollectorProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column({ unique: true, nullable: false })
  NationalID: string;

  @Column({ type: 'enum', enum: Shift })
  shift: Shift;


  @OneToOne(() => Account, (account) => account.CollectorProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
