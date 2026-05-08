import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExternalPartnerProfile } from '../profile/external-partner-profile.entity';
import { ExternalPartnerWasteCategory } from '@src/waste-management/entities/external-partner-waste-category.entity';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';
import { DeliverySchedule } from '@src/user/enums/delivery-schedule.enum';

@Entity('external_partner_materials')
export class ExternalPartnerMaterial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => ExternalPartnerProfile, (profile) => profile.externalPartnerMaterial, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'external_partner_profile_id' })
  externalPartnerProfile: ExternalPartnerProfile;

  @OneToMany(() => ExternalPartnerWasteCategory, (epwt) => epwt.externalPartnerMaterial, {
    cascade: true,
  })
  wasteTypes: ExternalPartnerWasteCategory[];

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
    nullable: true,
  })
  perferredDeliverySchedule?: DeliverySchedule;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}