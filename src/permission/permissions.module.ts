import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionCacheProvider } from './permission-cache.provider';


@Module({
  imports: [TypeOrmModule.forFeature([Permission, RolePermission])],
  controllers: [],
  providers: [PermissionsService, PermissionsGuard,PermissionCacheProvider],
  exports: [PermissionsService, PermissionsGuard]
})
export class PermissionsModule { }
