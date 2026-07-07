import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { WarehouseAdminService } from './warehouse-admin.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { IsIn, IsOptional } from 'class-validator';

class WarehouseListQuery extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

class SyncWarehouseBody {
  @IsOptional()
  force_full_sync?: boolean;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/warehouses', version: '1' })
export class WarehouseAdminController {
  constructor(private readonly warehouseAdmin: WarehouseAdminService) {}

  @Get()
  @Permissions('admin.warehouse.view')
  async list(@Query() query: WarehouseListQuery) {
    const result = await this.warehouseAdmin.list(query);
    return { message: 'Warehouses fetched successfully', result };
  }

  /** Create a warehouse from the backend (pushed to Odoo by a background job). */
  @Post()
  @Permissions('admin.warehouse.manage')
  async create(@Body() dto: CreateWarehouseDto) {
    const result = await this.warehouseAdmin.create(dto);
    return { message: result.message, result };
  }

  /** Mirror the manager the admin assigned to this warehouse inside Odoo. */
  @Post(':warehouseId/sync-manager')
  @Permissions('admin.warehouse.sync')
  async syncManager(@Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    const result = await this.warehouseAdmin.syncManagerFromOdoo(warehouseId);
    return { message: result.message, result };
  }

  /** Pull warehouses + managers FROM Odoo (they are created inside Odoo). */
  @Post('import-odoo')
  @Permissions('admin.warehouse.sync')
  async importFromOdoo() {
    const result = await this.warehouseAdmin.importFromOdoo();
    return { message: result.message, result };
  }

  @Get(':warehouseId/inventory')
  @Permissions('admin.warehouse.view')
  async inventory(@Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    const result = await this.warehouseAdmin.inventory(warehouseId);
    return { message: 'Inventory fetched successfully', result };
  }

  @Post(':warehouseId/sync-odoo')
  @Permissions('admin.warehouse.sync')
  async sync(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() body: SyncWarehouseBody,
  ) {
    const result = await this.warehouseAdmin.sync(warehouseId, body?.force_full_sync);
    return { message: result.message, result };
  }
}
