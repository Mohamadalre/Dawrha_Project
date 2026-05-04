import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne
} from 'typeorm';
import { Account } from '../account.entity';
import { LocationBase } from '@src/common/entities/location-base.entity';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';
import { InstitutionWasteCategory } from '@src/waste-management/entities/institution-waste-category.entity';
import { InstitutionType } from '@src/institution/entities/institution-type.entity';




@Entity('institution_profiles')
export class InstitutionProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Account, (account) => account.institutionProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @OneToOne(() => InstitutionType, (institutionType) => institutionType.institutionProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'institutionType' })
  institutionType: InstitutionType;

  @ManyToOne(() => InstitutionType, { nullable: true })
  @JoinColumn({ name: 'type_id' })
  type: InstitutionType;

  @Column({ nullable: true })
  otherInstitutionType: string;
  
  @OneToMany(() => InstitutionWasteCategory, (iwt) => iwt.institution, {
    cascade: true
  })
  wasteTypes: InstitutionWasteCategory[];

  @Column()
  institutionName: string;


  @Column({ unique: true, nullable: false })
  institutionPhone: string;

  @Column({ unique: true, nullable: false })
  licenseNumber: string;

  @Column({ nullable: true })
  taxNumber?: string;

  @Column({ nullable: true })
  institutionSlogo?: string;

  @Column()
  estimatedWasteQuantity: string;
  @Column({
    type: 'enum',
    enum: CollectionFrequeny,
  })
  collectionFrequney: CollectionFrequeny;

  @Column('text', { array: true })
  preferredCollectionTime: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
