import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Platform-wide settings — a SINGLE row.
 *
 * Today it holds the one fact the whole app used to hardcode in ~18 places: the
 * default pricing currency. New priced rows read their currency from here, so
 * changing the platform currency is one edit rather than a code sweep. Existing
 * rows keep the currency they were stored with (history is not rewritten).
 *
 * `singleton` is a UNIQUE, always-true flag: it makes a second settings row
 * impossible at the database level, so "the settings" is unambiguous.
 */
@Entity('platform_settings')
export class PlatformSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, default: true })
  singleton: boolean;

  /** ISO-ish currency code applied to new priced rows, e.g. 'SYP'. */
  @Column({ length: 8, default: 'SYP' })
  defaultCurrency: string;

  /** The admin who last changed the settings. */
  @Column({ nullable: true })
  updatedBy?: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
