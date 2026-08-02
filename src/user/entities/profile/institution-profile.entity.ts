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


  /**
   * The institution's phone — a MOBILE.
   *
   * Held a landline, with a separate mobile column beside it. Two columns for
   * one answer is two places to look and one of them is always the wrong one:
   * a driver standing at a locked gate with a pallet on the truck needs the
   * number of somebody who will pick up, and a building's landline is not it
   * outside office hours. Factories and free facilities were already asked for
   * a single mobile — so the same delivery was resolvable or not depending only
   * on which kind of buyer it was going to.
   *
   * One column, not two, exactly as the free facility already does it.
   */
  @Column({ nullable: false, unique: true })
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
