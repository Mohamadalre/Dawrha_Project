import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId?: string;

  @Column()
  action: string;

  @Index()
  @Column()
  entityType: string;

  @Column({ type: 'uuid', nullable: true })
  entityId?: string;

  @Column({ type: 'jsonb', nullable: true })
  oldValues?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  newValues?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
