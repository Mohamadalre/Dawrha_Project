import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  OneToMany,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { LocationBase } from '@src/common/entities/location-base.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { DeliverySchedule } from '@src/user/enums/delivery-schedule.enum';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';
;


@Entity('factory_profiles')
export class FactoryProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @OneToMany(() => FactoryWasteCategory, (fwt) => fwt,{
    cascade:true
  })
  wasteTypes: FactoryWasteCategory[];

  @Column()
  factoryName: string;

  @Column({ unique: true, nullable: false })
  factoryPhone: string;

  @Column({ unique: true, nullable: false })
  commercialRecord: string;

  @Column({ unique: true, nullable: false })
  industrialRecord: string;

  @Column({ nullable: true })
  taxNumber?: string;

  @Column({nullable:true})
  factorySlogo?: string;

  @Column()
  averageOrderQuantity: string;

  @Column({
    type: 'enum',
    enum: CollectionFrequeny,

  })
  estimationOrderSchedule: CollectionFrequeny;

  @Column({ default: false })
  deliveryPreference: boolean;

  @Column({
    type: 'enum',
    enum: DeliverySchedule,
    nullable: true
  })
  perferredDeliverySchedule?: DeliverySchedule;


  @OneToOne(() => Account, (account) => account.factoryProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
