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

  @Column('text', { array: true })
  preferredCollectionTime: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}