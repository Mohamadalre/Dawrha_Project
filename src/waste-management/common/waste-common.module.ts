import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { MeasurementUnit } from '../entities/measurement-unit.entity';
import { MaterialCondition } from '../entities/material-condition.entity';
import { InstitutionWasteCategory } from '../entities/institution-waste-category.entity';
import { FactoryWasteCategory } from '../entities/factory-waste-category.entity';
import { ExternalPartnerWasteCategory } from '../entities/external-partner-waste-category.entity';
import { Permission } from '@src/permission/entities/permission.entity';
import { RolePermission } from '@src/permission/entities/role-permission.entity';
import { AuditService } from './providers/audit.service';
import { AssignedCategoryProvider } from './providers/assigned-category.provider';
import { PermissionSeederService } from './providers/permission-seeder.service';
import { CatalogCacheService } from './providers/catalog-cache.service';
import { UnitsService } from './providers/units.service';
import { ConditionsService } from './providers/conditions.service';
import { SellabilityService } from './providers/sellability.service';
import { BuyerProfileService } from './providers/buyer-profile.service';
import { FactoryProfile } from '@src/user/entities/profile/factory-profile.entity';
import { ExternalPartnerProfile } from '@src/user/entities/profile/external-partner-profile.entity';
import { ProductPricing } from '../entities/product-pricing.entity';

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
      MeasurementUnit,
      MaterialCondition,
      ProductPricing,
      InstitutionWasteCategory,
      FactoryWasteCategory,
      ExternalPartnerWasteCategory,
      Permission,
      RolePermission,
      // Buyer profiles: the governorate on them is what BOTH order allocation
      // and catalogue availability scope themselves to. One lookup, shared, so
      // the stock a buyer is shown and the stock they can actually be sent can
      // never be computed from two different answers.
      FactoryProfile,
      ExternalPartnerProfile,
    ]),
  ],
  providers: [
    AuditService,
    AssignedCategoryProvider,
    PermissionSeederService,
    CatalogCacheService,
    UnitsService,
    ConditionsService,
    SellabilityService,
    BuyerProfileService,
  ],
  exports: [
    AuditService,
    AssignedCategoryProvider,
    CatalogCacheService,
    UnitsService,
    ConditionsService,
    SellabilityService,
    BuyerProfileService,
  ],
})
export class WasteCommonModule {}
