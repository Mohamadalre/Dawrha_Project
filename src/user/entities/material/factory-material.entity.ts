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
import { FactoryProfile } from '../profile/factory-profile.entity';
import { FactoryWasteCategory } from '@src/waste-management/entities/factory-waste-category.entity';
import { DeliverySchedule } from '@src/user/enums/delivery-schedule.enum';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';

@Entity('factory_materials')
export class FactoryMaterial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => FactoryProfile, (profile) => profile.factoryMaterial, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'factory_profile_id' })
  factoryProfile: FactoryProfile;

  @OneToMany(() => FactoryWasteCategory, (fwt) => fwt.factoryMaterial, {
    cascade: true,
  })
  wasteTypes: FactoryWasteCategory[];

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
