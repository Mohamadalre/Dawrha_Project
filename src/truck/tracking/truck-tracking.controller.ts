import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { TruckTrackingService } from './truck-tracking.service';

/**
 * REST fallback so the admin dashboard can read the latest position / active
 * fleet / history without holding a socket (e.g. on first page load).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({ path: 'trucks', version: '1' })
export class TruckTrackingController {
  constructor(private readonly tracking: TruckTrackingService) {}

  @Get('active')
  async active() {
    const result = await this.tracking.getActiveTrucks();
    return { message: 'Active trucks fetched successfully', result };
  }

  @Get(':truckId/location')
  async location(@Param('truckId', ParseUUIDPipe) truckId: string) {
    const location = await this.tracking.getLocation(truckId);
    if (!location) throw new NotFoundException('No location recorded for this truck');
    return { message: 'Truck location fetched successfully', result: location };
  }

  @Get(':truckId/history')
  async history(
    @Param('truckId', ParseUUIDPipe) truckId: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.tracking.getHistory(truckId, limit ? Number(limit) : 50);
    return { message: 'Truck history fetched successfully', result };
  }

  @Get(':truckId/last-stop')
  async lastStop(@Param('truckId', ParseUUIDPipe) truckId: string) {
    const result = await this.tracking.getLastStop(truckId);
    if (!result) throw new NotFoundException('No stop recorded for this truck');
    return { message: 'Last stop fetched successfully', result };
  }
}
