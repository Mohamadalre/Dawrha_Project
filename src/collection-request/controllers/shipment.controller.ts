import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { ShipmentService } from '../services/shipment.service';
import { DeliverShipmentDto } from '../dto/shipment.dto';
import { ShipmentStatus } from '../enums/shipment-status.enum';

/**
 * Driver shipment APIs: list, detail, deliver, cancel.
 * Admin APIs: list/filter all shipments.
 *
 * Shipments are auto-created when a driver accepts a collection request —
 * no manual creation endpoint.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'shipments', version: '1' })
export class ShipmentController {
  constructor(private readonly shipmentService: ShipmentService) {}

  // ---------------------------------------------------------------------------
  // Driver
  // ---------------------------------------------------------------------------

  /** List my shipments. */
  @Get()
  @Permissions('collection.driver.view')
  async myShipments(@CurrentUser() user: any) {
    const result = await this.shipmentService.myShipments(user.id);
    return { message: 'Shipments fetched', result };
  }

  /** Shipment detail with linked requests. */
  @Get(':id')
  @Permissions('collection.driver.view')
  async detail(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.shipmentService.detail(user.id, id);
    return { message: 'Shipment fetched', result };
  }

  /** Deliver to warehouse: IN_TRANSIT → DELIVERED. All requests → COMPLETED. */
  @Patch(':id/deliver')
  @Permissions('collection.driver.manage')
  async deliver(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliverShipmentDto,
  ) {
    const result = await this.shipmentService.deliver(user.id, id, dto);
    return { message: 'Shipment delivered — all requests completed', result };
  }

  /** Cancel shipment and unlink requests. */
  @Patch(':id/cancel')
  @Permissions('collection.driver.manage')
  async cancel(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.shipmentService.cancel(user.id, id);
    return { message: 'Shipment cancelled', result };
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  /** Admin: list all shipments with filters. */
  @Get('admin/all')
  @Permissions('collection.admin.view')
  async adminList(
    @Query('status') status?: ShipmentStatus,
    @Query('driver_id') driverId?: string,
    @Query('warehouse_id') warehouseId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.shipmentService.adminList({
      status,
      driverId,
      warehouseId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { message: 'Shipments fetched', result };
  }
}
