import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { TruckTrackingService } from './truck-tracking.service';
import { HandoverService } from '../handover.service';

/**
 * How many history points to return. A validated positive integer, not a raw
 * query string: `?limit=abc` (→ NaN) or `?limit=-5` used to reach the service
 * untouched. `@Type` coerces the query string to a number so the whole app's
 * pagination inputs are numbers, never strings.
 */
class HistoryQueryDto {
  @IsOptional()
  // Coerced to a number; a non-number ("abc") is a 400, never silently defaulted.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 50;
}

/**
 * REST fallback so the admin dashboard can read the latest position / active
 * fleet / history without holding a socket (e.g. on first page load).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'trucks', version: '1' })
export class TruckTrackingController {
  constructor(
    private readonly tracking: TruckTrackingService,
    private readonly handover: HandoverService,
  ) {}

  @Get('active')
  @Permissions('admin.trucks.view')
  async active() {
    const result = await this.tracking.getActiveTrucks();
    return { message: 'Active trucks fetched successfully', result };
  }

  @Get(':truckId/location')
  @Permissions('admin.trucks.view')
  async location(@Param('truckId', ParseUUIDPipe) truckId: string) {
    const location = await this.tracking.getLocation(truckId);
    if (!location) throw new NotFoundException('No location recorded for this truck');
    return { message: 'Truck location fetched successfully', result: location };
  }

  @Get(':truckId/history')
  @Permissions('admin.trucks.view')
  async history(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query() query: HistoryQueryDto,
  ) {
    const result = await this.tracking.getHistory(truckId, query.limit);
    return { message: 'Truck history fetched successfully', result };
  }

  @Get(':truckId/last-stop')
  @Permissions('admin.trucks.view')
  async lastStop(@Param('truckId', ParseUUIDPipe) truckId: string) {
    const result = await this.tracking.getLastStop(truckId);
    if (!result) throw new NotFoundException('No stop recorded for this truck');
    return { message: 'Last stop fetched successfully', result };
  }

  /**
   * A truck's handover sessions (trips), newest first — each with WHO drove it
   * and the trip's START (pickup point + time) and END (dropoff point + time +
   * note). This is the admin's window onto where each trip began and ended,
   * which the live-position/last-stop views do not show on their own.
   */
  @Get(':truckId/handovers')
  @Permissions('admin.trucks.view')
  async handovers(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const result = await this.handover.listForTruck(truckId, page, limit);
    return { message: 'Truck handovers fetched successfully', result };
  }
}
