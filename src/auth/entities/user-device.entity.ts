import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_devices')
export class UserDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  accountId: string;

  @Column({ nullable: true })
  refreshToken: string;

  @Column({ nullable: true })
  fcmToken: string;

  @Column({ unique:true,nullable: true })
  deviceId: string;


  @Column({ nullable: true })
  deviceType: string;

  @Column({ type: 'timestamp', nullable: true })
  lastLogin: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
