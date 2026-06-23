import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '@src/waste-management/entities/audit-log.entity';

export interface AuditEntry {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}

/**
 * Lightweight audit-trail writer for create/update/delete operations across the
 * marketplace. Failures are swallowed (logged only) so auditing never breaks the
 * primary business operation.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditRepo.save(this.auditRepo.create(entry));
    } catch (error) {
      this.logger.warn(`Failed to write audit log for ${entry.action}`, error as Error);
    }
  }
}
