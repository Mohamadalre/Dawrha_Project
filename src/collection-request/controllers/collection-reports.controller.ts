import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CollectionReportsService } from '../services/collection-reports.service';
import { AdminListRequestsQueryDto } from '../dto/admin-collection.dto';

/**
 * Read-only admin reports over collection activity: the daily summary, the
 * request ledger (same filters as the admin list) and the routes ledger.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/reports/collection', version: '1' })
export class CollectionReportsController {
  constructor(private readonly reports: CollectionReportsService) {}

  @Get('daily')
  @Permissions('admin.reports.view')
  async daily(@Query('date') date?: string) {
    const result = await this.reports.daily(date);
    return { message: 'Daily collection summary', result };
  }

  @Get('requests')
  @Permissions('admin.reports.view')
  async requests(@Query() query: AdminListRequestsQueryDto) {
    const result = await this.reports.requests(query);
    return { message: 'Collection requests report', result };
  }

  @Get('routes')
  @Permissions('admin.reports.view')
  async routes(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('driverId') driverId?: string,
  ) {
    const result = await this.reports.routes({ from, to, driverId });
    return { message: 'Collection routes report', result };
  }
}