import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { InstitutionWasteCategory } from '../entities/institution-waste-category.entity';
import { FactoryWasteCategory } from '../entities/factory-waste-category.entity';
import { ExternalPartnerWasteCategory } from '../entities/external-partner-waste-category.entity';
import { Permission } from '@src/permission/entities/permission.entity';
import { RolePermission } from '@src/permission/entities/role-permission.entity';
import { AuditService } from './providers/audit.service';
import { AssignedCategoryProvider } from './providers/assigned-category.provider';
import { PermissionSeederService } from './providers/permission-seeder.service';

/**
 * Domain kernel for the waste-management marketplace. Holds the cross-cutting
 * providers shared by the feature modules (catalog, cart, suggestions, admin)
 * and seeds the permission keys on boot. Import this wherever a feature needs
 * AuditService or AssignedCategoryProvider.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLog,
      InstitutionWasteCategory,
      FactoryWasteCategory,
      ExternalPartnerWasteCategory,
      Permission,
      RolePermission,
    ]),
  ],
  providers: [AuditService, AssignedCategoryProvider, PermissionSeederService],
  exports: [AuditService, AssignedCategoryProvider],
})
export class WasteCommonModule {}
