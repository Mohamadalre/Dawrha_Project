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

/** One detailed delivery window: a weekday and a start→end 24h time. */
export interface DeliveryTimeSlot {
  day: string;
  from: string;
  to: string;
}

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

  // Typical order size — a positive number (stored decimal; TypeORM reads it
  // back as a string).
  @Column('decimal', { precision: 14, scale: 3 })
  averageOrderQuantity: string;

  // Whether the factory wants the order delivered or will collect it itself.
  @Column({ default: false })
  deliveryPreference: boolean;

  // The detailed windows the factory can receive a delivery in — replaces the
  // old single morning/afternoon/evening choice. Null when it self-collects.
  @Column({ type: 'jsonb', nullable: true })
  deliveryTimeSlots?: DeliveryTimeSlot[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
