import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm';
import { InstitutionProfile } from '../profile/institution-profile.entity';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';
import { InstitutionWasteCategory } from '@src/waste-management/entities/institution-waste-category.entity';
import { DeliveryTimeSlot } from './factory-material.entity';

@Entity('institution_materials')
export class InstitutionMaterial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => InstitutionProfile, (profile) => profile.materialInputs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'institution_profile_id' })
  institutionProfile: InstitutionProfile;

  @OneToMany(() => InstitutionWasteCategory, (iwt) => iwt.institution, {
    cascade: true
  })
  wasteTypes: InstitutionWasteCategory[];

  @Column()
  estimatedWasteQuantity: string;

  @Column({
    type: 'enum',
    enum: CollectionFrequeny,

  })
  collectionFrequney: CollectionFrequeny;

  // Detailed collection windows (weekday + start→end time). Was a text[] of
  // free strings; now the same structured slot a factory's delivery windows use.
  @Column({ type: 'jsonb', nullable: true })
  preferredCollectionTime?: DeliveryTimeSlot[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}