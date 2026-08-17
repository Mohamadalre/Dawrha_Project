import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Role } from '../enums/role.enum';
import { AccountStatus } from '../enums/account-status.enum';
import { AuthProvider } from '../enums/auth-provider.enum';
import { Language } from '@src/common/enums/language.enum';
import { CollectorProfile } from './profile/collector-profile.entity';
import { FactoryProfile } from './profile/factory-profile.entity';
import { CitizenProfile } from './profile/citizen-profile.entity';
import { InstitutionProfile } from './profile/institution-profile.entity';
import { ExternalPartnerProfile } from './profile/external-partner-profile.entity';
import { UserDevice } from '@src/auth/entities/user-device.entity';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true, nullable: true })
  phone?: string;

  @Column({ nullable: true })
  @Exclude()
  passwordHash?: string;

  @Column({ nullable: true })
  profileImage?: string;

  /** The account holder's OWN words. They write it, they read it. */
  @Column({ default: '' })
  description: string;

  /**
   * The reviewer's note: why an application was rejected, why an account was
   * blocked.
   *
   * A separate column because it was sharing `description` with the line
   * above — the field the account holder edits in `PATCH /user/profile` and
   * reads back in `GET /user/profile`. Blocking someone for suspected fraud
   * therefore printed the reason on their own profile screen and let them
   * overwrite it. An internal note that the subject can read is not an
   * internal note, and one they can rewrite is not a record.
   *
   * Never returned by any route the account holder can call.
   */
  @Column({ type: 'text', nullable: true })
  @Exclude()
  adminNote?: string | null;

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

  /**
   * The account's chosen response language. Set once in settings and then every
   * API response comes back in it — the client never has to send a language
   * header. Defaults to English until the holder picks otherwise.
   */
  @Column({
    type: 'enum',
    enum: Language,
    default: Language.EN,
  })
  language: Language;

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
  @OneToMany(() => UserDevice, (device) => device.account)
  devices: UserDevice[];
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

  /**
   * Soft-archive marker. Null = a live account. When set, "delete" has been
   * performed: the row survives (its email/phone stay claimed so the same
   * person cannot silently re-register on them), its data is kept for audit,
   * but login treats it as not found and any token it still holds is refused on
   * every route.
   */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt?: Date | null;

  /** The admin who archived it. */
  @Column({ name: 'archived_by', type: 'uuid', nullable: true })
  archivedBy?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
