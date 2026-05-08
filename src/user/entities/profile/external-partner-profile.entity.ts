import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm';
import { Account } from '../account.entity';
import { LocationBase } from '@src/common/entities/location-base.entity';
import { ExternalPartnerMaterial } from '../material/external-partner-material.entity';

@Entity('external_partner_profiles')
export class ExternalPartnerProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => ExternalPartnerMaterial, (material) => material.externalPartnerProfile, { cascade: true })
  @JoinColumn({ name: 'material_id' })
  externalPartnerMaterial: ExternalPartnerMaterial;

  @Column()
  externalPartnerName: string;

  @Column({  nullable: false ,unique:true})
  externalPartnerPhone: string;

  @Column({ nullable: true })
  externalPartnerSlogo?: string;


  @OneToOne(() => Account, (account) => account.externalPartnerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
