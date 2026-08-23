import {
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

  // NOTE: the driver no longer marks a shipment delivered by hand. A shipment
  // becomes DELIVERED automatically when the driver's tour completes (he dropped
  // the load), and RECEIVED when the RECEPTION employee CONFIRMS its receipt in
  // Odoo — scanning the QR only fetches the load (getShipmentForReception); the
  // confirm step flips the status (confirmShipmentReceipt). See
  // OdooReceptionController. Receipt is the warehouse's confirmation, not the
  // driver's claim.

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
