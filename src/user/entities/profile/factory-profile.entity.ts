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
;


@Entity('factory_profiles')
export class FactoryProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  factoryName: string;

  @Column({ unique: true, nullable: false })
  commercialRegister: string;

  @Column({ unique: true, nullable: false })
  factoryRegister: string;

  @Column({ nullable: true })
  taxNumber?: string;
  @Column()
  factorySlogo: string;

  @Column()
  wasteType: string;
  @Column()
  demandEstimate: string;
  @Column({ unique: true, nullable: false })
  factoryPhone: string;

  @OneToOne(() => Account, (account) => account.factoryProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
