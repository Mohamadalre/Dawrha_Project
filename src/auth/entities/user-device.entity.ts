import { Account } from '@src/user/entities/account.entity';
import { DeviceType } from '@src/user/enums/deviec-type.enum';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, JoinColumn, ManyToOne } from 'typeorm';

@Index(['accountId', 'deviceId'], { unique: true })
@Entity('user_devices')
export class UserDevice {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  accountId: string;

  @ManyToOne(() => Account, (account) => account.devices, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ type: 'text', nullable: true })
  refreshToken: string;

  @Column({ nullable: true })
  fcmToken: string;

  @Column({ unique: true, nullable: true })
  deviceId: string;


  @Column({
    type: 'enum',
    enum: DeviceType,
    nullable: true
  })
  deviceType: DeviceType;

  @Column({ type: 'timestamp', nullable: true })
  lastLogin: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
