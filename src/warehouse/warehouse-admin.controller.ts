import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { WarehouseAdminService } from './warehouse-admin.service';
import { InventoryQueryService } from './providers/inventory-query.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

class WarehouseListQuery extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  /**
   * Part of a warehouse NAME or CODE.
   *
   * Matched as a substring, case-insensitively, against both — an admin arrives
   * at a warehouse from either direction: they half-remember what it is called,
   * or they are holding paperwork that carries only the code. Requiring the
   * whole word would mean already knowing the answer to the question being
   * asked.
   */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
}

class SyncWarehouseBody {
  @IsOptional()
  force_full_sync?: boolean;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/warehouses', version: '1' })
export class WarehouseAdminController {
  constructor(
    private readonly warehouseAdmin: WarehouseAdminService,
    private readonly inventoryQuery: InventoryQueryService,
  ) {}

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
    return this.warehouseAdmin.create(dto);
  }

  /** Mirror the manager the admin assigned to this warehouse inside Odoo. */
  // 200: this READS Odoo and refreshes the mirror — nothing is created here.
  @HttpCode(HttpStatus.OK)
  @Post(':warehouseId/sync-manager')
  @Permissions('admin.warehouse.sync')
  async syncManager(@Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    return this.warehouseAdmin.syncManagerFromOdoo(warehouseId);
  }

  /** Pull warehouses + managers FROM Odoo (they are created inside Odoo). */
  // 200: an idempotent bulk refresh that returns a summary, not a new resource
  // at a new URL — re-running it is a no-op, which 201 would misdescribe.
  @HttpCode(HttpStatus.OK)
  @Post('import-odoo')
  @Permissions('admin.warehouse.sync')
  async importFromOdoo() {
    return this.warehouseAdmin.importFromOdoo();
  }

  /** One warehouse, in the same shape as a row of the listing. */
  @Get(':warehouseId')
  @Permissions('admin.warehouse.view')
  async detail(@Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    const result = await this.warehouseAdmin.detail(warehouseId);
    return { message: 'Warehouse fetched successfully', result };
  }

  /** Edit a warehouse's own details (name / code / address / capacity / …). */
  @Patch(':warehouseId')
  @Permissions('admin.warehouse.manage')
  async update(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    const result = await this.warehouseAdmin.update(warehouseId, dto);
    return { message: 'Warehouse updated successfully', result };
  }

  /**
   * Everything this warehouse holds, a page of MATERIALS at a time.
   *
   * Paged over materials, not over the mirror rows underneath them: a cut
   * through the raw rows would return half a material's grades and the totals
   * printed on that card would be wrong without looking wrong.
   */
  @Get(':warehouseId/inventory')
  @Permissions('admin.warehouse.view')
  async inventory(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.inventoryQuery.listForWarehouse(
      warehouseId,
      query.page,
      query.limit,
    );
  }

  // 202 Accepted: the sync is ENQUEUED and finishes in a background worker,
  // so the response only acknowledges the request (same as the Odoo webhooks).
  @HttpCode(HttpStatus.ACCEPTED)
  @Post(':warehouseId/sync-odoo')
  @Permissions('admin.warehouse.sync')
  async sync(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() body: SyncWarehouseBody,
  ) {
    return this.warehouseAdmin.sync(warehouseId, body?.force_full_sync);
  }
}
