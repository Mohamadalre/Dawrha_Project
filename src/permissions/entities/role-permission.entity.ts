import { Entity, PrimaryGeneratedColumn, Column,ManyToOne } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { Permission } from './permission.entity';
Permission
@Entity()
export class RolePermission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: Role })
  role: Role;

  @ManyToOne(() => Permission, { eager: true })
  permission: Permission;
}