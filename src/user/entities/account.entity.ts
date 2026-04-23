import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Role } from '../enums/role.enum';
import { AccountStatus } from '../enums/account-status.enum';
import { AuthProvider } from '../enums/auth-provider.enum';
import { CollectorProfile } from './profile/collector-profile.entity';
import { FactoryProfile } from './profile/factory-profile.entity';
import { CitizenProfile } from './profile/citizen-profile.entity';
import { InstitutionProfile } from './profile/institution-profile.entity';
import { ExternalPartnerProfile } from './profile/external-partner-profile.entity';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name:string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true, nullable: true })
  phone?: string;

  @Column({ nullable: true })
  @Exclude()
  passwordHash?: string;

  @Column({ nullable: true })
  profileImage?: string;

  @Column({
    type: 'enum',
    enum: Role,
    default: Role.CITIZEN,
  })
  role: Role;

  @Column({
    type: 'enum',
    enum: AccountStatus,
    default: AccountStatus.INACTIVE,
  })
  accountStatus: AccountStatus;

  @Column({ default: false })
  isEmailVerified: boolean;

  @Column({ nullable: true, unique: true })
  googleId?: string;

  @Column({
    type: 'enum',
    enum: AuthProvider,
    default: AuthProvider.LOCAL
  })
  provider: AuthProvider;

  @OneToOne(() => CollectorProfile, (profile) => profile.account, { cascade: true, nullable: true })
  CollectorProfile: CollectorProfile;

  @OneToOne(() => FactoryProfile, (profile) => profile.account, { cascade: true, nullable: true })
  factoryProfile: FactoryProfile;

  @OneToOne(() => CitizenProfile, (profile) => profile.account, { cascade: true, nullable: true })
  citizenProfile: CitizenProfile;

  @OneToOne(() => InstitutionProfile, (profile) => profile.account, { cascade: true, nullable: true })
  institutionProfile: InstitutionProfile;

  @OneToOne(() => ExternalPartnerProfile, (profile) => profile.account, { cascade: true, nullable: true })
  externalPartnerProfile: ExternalPartnerProfile;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
