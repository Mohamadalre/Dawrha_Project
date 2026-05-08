import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne
} from 'typeorm';
import { Account } from '../account.entity';
import { LocationBase } from '@src/common/entities/location-base.entity';
import { InstitutionType } from '@src/institution/entities/institution-type.entity';
import { InstitutionMaterial } from '../material/institution-material.entity';




@Entity('institution_profiles')
export class InstitutionProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Account, (account) => account.institutionProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @OneToOne(() => InstitutionMaterial, (inputs) => inputs.institutionProfile, { cascade: true })
  @JoinColumn({ name: 'material_id' })
  materialInputs: InstitutionMaterial;

  
  @ManyToOne(() => InstitutionType, { nullable: true })
  @JoinColumn({ name: 'type_id' })
  institutionType: InstitutionType;

  @Column({ nullable: true })
  otherInstitutionType: string;



  @Column()
  institutionName: string;


  @Column({  nullable: false ,unique:true })
  institutionPhone: string;

  @Column({  nullable: false  , unique:true})
  licenseNumber: string;

  @Column({ nullable: true })
  taxNumber?: string;

  @Column({ nullable: true })
  institutionSlogo?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
