import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../account.entity';
import { LocationBase } from '@src/common/entities/location-base.entity';
import { CollectionFrequeny } from '@src/user/enums/collectionFrequeny.enum';




@Entity('institution_profiles')
export class InstitutionProfile extends LocationBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Account, (account) => account.institutionProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column()
  institutionName: string;


  @Column({ unique: true, nullable: false })
  institutionPhone: string;

  @Column()
  institutionType: string;

  @Column({ unique: true, nullable: false })
  licenseNumber: string;

  @Column({ nullable: true })
  taxNumber?: string;

  @Column()
  institutionSlogo: string;



  @Column()
  wasteType: string;

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
