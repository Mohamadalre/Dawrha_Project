import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { RouteExecutionService } from '../services/route-execution.service';
import { CollectedRequestDto } from '../dto/driver-execution.dto';

/**
 * The driver's execution endpoints: his ordered tour, and the punches
 * that move a stop from ASSIGNED to PICKING (arrive, weigh).
 *
 * Delivery is handled at the **shipment** level via PATCH /shipments/:id/deliver.
 *
 * Every route is guarded by the state machine — an out-of-order punch is a
 * 409, a stop on someone else's tour is a 404 — and the response messages go
 * through the i18n pipeline like the rest of the API.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'driver/collection-requests', version: '1' })
export class DriverExecutionController {
  constructor(private readonly execution: RouteExecutionService) {}

  @Get()
  @Permissions('collection.driver.view')
  async myTour(@CurrentUser() user: { id: string; role: string }) {
    const result = await this.execution.myTour(user);
    return { message: 'Your tour', result };
  }

  @Patch(':id/arrived')
  @Permissions('collection.driver.manage')
  async arrived(@CurrentUser() user: { id: string; role: string }, @Param('id', ParseUUIDPipe) id: string) {
    await this.execution.arrived(user, id);
    return { message: 'Arrival recorded', result: { request_id: id, status: 'ARRIVED' } };
  }

  @Patch(':id/collected')
  @Permissions('collection.driver.manage')
  async collected(
    @CurrentUser() user: { id: string; role: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectedRequestDto,
  ) {
    const result = await this.execution.collected(user, id, dto);
    return { message: 'Weight recorded', result: { request_id: id, status: 'PICKING', ...result } };
  }
}