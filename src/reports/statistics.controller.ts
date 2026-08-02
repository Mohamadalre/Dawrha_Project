import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { StatisticsService } from './statistics.service';

/**
 * Admin reporting endpoints. All guarded by `admin.reports.view`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/reports', version: '1' })
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get('overview')
  @Permissions('admin.reports.view')
  async overview() {
    const result = await this.statistics.getOverview();
    return { message: 'Statistics fetched successfully', result };
  }

  @Get('accounts')
  @Permissions('admin.reports.view')
  async accounts() {
    const result = await this.statistics.getAccountStats();
    return { message: 'Account statistics fetched successfully', result };
  }

  @Get('trucks')
  @Permissions('admin.reports.view')
  async trucks() {
    const result = await this.statistics.getTruckStats();
    return { message: 'Truck statistics fetched successfully', result };
  }

  @Get('drivers')
  @Permissions('admin.reports.view')
  async drivers() {
    const result = await this.statistics.getDriverStats();
    return { message: 'Driver statistics fetched successfully', result };
  }

  @Get('warehouses')
  @Permissions('admin.reports.view')
  async warehouses() {
    const result = await this.statistics.getWarehouseStats();
    return { message: 'Warehouse statistics fetched successfully', result };
  }

  @Get('catalog')
  @Permissions('admin.reports.view')
  async catalog() {
    const result = await this.statistics.getCatalogStats();
    return { message: 'Catalogue statistics fetched successfully', result };
  }
}
