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

  // Typical order size — a positive number (stored decimal; read back as a
  // string). A free facility gives only this and its categories.
  @Column('decimal', { precision: 14, scale: 3 })
  averageOrderQuantity: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}