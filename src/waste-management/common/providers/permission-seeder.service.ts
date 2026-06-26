import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '@src/permission/entities/permission.entity';
import { RolePermission } from '@src/permission/entities/role-permission.entity';
import { Role } from '@src/user/enums/role.enum';
import { ROLE_PERMISSIONS_MAP, WASTE_PERMISSIONS } from '../constants/permissions';

/**
 * Idempotently seeds the waste-management permission keys and their role mappings
 * into the database tables owned by the permission module (permissions /
 * role_permissions). This lets the existing PermissionsGuard authorise the new
 * endpoints without us touching the permission module's code.
 */
@Injectable()
export class PermissionSeederService implements OnModuleInit {
  private readonly logger = new Logger(PermissionSeederService.name);

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seed();
    } catch (error) {
      // Never block application bootstrap on seeding; just surface the issue.
      this.logger.error('Permission seeding failed', error as Error);
    }
  }

  private async seed(): Promise<void> {
    const keys = Object.keys(WASTE_PERMISSIONS);

    // 1) Ensure every permission key exists.
    const existing = await this.permissionRepo.find();
    const existingKeys = new Set(existing.map((p) => p.key));
    const byKey = new Map(existing.map((p) => [p.key, p]));

    for (const key of keys) {
      if (!existingKeys.has(key)) {
        const saved = await this.permissionRepo.save(
          this.permissionRepo.create({ key }),
        );
        byKey.set(key, saved);
      }
    }

    // 2) Ensure each role has its mapped permissions.
    let created = 0;
    for (const [role, permKeys] of Object.entries(ROLE_PERMISSIONS_MAP) as [
      Role,
      string[],
    ][]) {
      const roleRows = await this.rolePermissionRepo.find({
        where: { role },
        relations: ['permission'],
      });
      const heldKeys = new Set(roleRows.map((r) => r.permission?.key));

      for (const key of permKeys) {
        if (!heldKeys.has(key)) {
          const permission = byKey.get(key);
          if (!permission) continue;
          await this.rolePermissionRepo.save(
            this.rolePermissionRepo.create({ role, permission }),
          );
          created++;
        }
      }
    }

    if (created > 0) {
      this.logger.log(`Seeded ${created} role-permission mapping(s) for waste-management`);
    }
  }
}
