import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany
} from 'typeorm';
import { Account } from '../account.entity';
import { LocationBase } from '@src/common/entities/location-base.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';
import { DeliverySchedule } from '@src/user/enums/delivery-schedule.enum';

@Entity('external_partner_profiles')
export class ExternalPartnerProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToMany(() => ExternalPartnerWasteCategory, (ept) => ept)
  wasteTypes: ExternalPartnerWasteCategory[];

  @Column()
  externalPartnerName: string;

  @Column({ unique: true, nullable: false })
  externalPartnerPhone: string;

  @Column({nullable:true})
  externalPartnerSlogo?: string;

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


  @OneToOne(() => Account, (account) => account.externalPartnerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
