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

  /**
   * The facility's phone — a MOBILE.
   *
   * Held a landline until now, which reaches the premises during office hours.
   * A driver standing at a locked gate with a pallet on the truck needs the
   * number of somebody who will pick up, and factories were already asked for
   * exactly that — so the same delivery was resolvable or not depending only on
   * which kind of buyer it was going to.
   *
   * One column, not two: a second "mobile" column beside a landline is two
   * places to look for one answer, and the one a driver needs is this one.
   */
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
