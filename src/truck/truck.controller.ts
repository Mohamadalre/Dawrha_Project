import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { TruckService } from './truck.service';
import { ListTrucksQueryDto } from './dto/list-trucks.query.dto';

/**
 * READ-ONLY fleet views. Trucks are created/edited in ODOO (linked to their
 * warehouse there) and mirrored here by the SYNC_FLEET job; driver-truck
 * assignments are also decided in Odoo. The backend only displays them.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'trucks', version: '1' })
export class TruckController {
  constructor(private readonly truckService: TruckService) {}

  /** List trucks filtered by status / shift / warehouse (paginated). */
  @Get()
  @Permissions('admin.trucks.view')
  async list(@Query() query: ListTrucksQueryDto) {
    const result = await this.truckService.list(query);
    return { message: 'Trucks fetched successfully', result };
  }

  /** List drivers grouped by whether they are linked to a truck. */
  @Get('drivers')
  @Permissions('admin.trucks.view')
  async drivers(@Query('assigned') assigned?: string, @Query('shiftId') shiftId?: string) {
    const flag = assigned === 'true' ? true : assigned === 'false' ? false : undefined;
    const result = await this.truckService.getDrivers(flag, shiftId);
    return { message: 'Drivers fetched successfully', result };
  }

  /** Single truck details (includes its warehouse). */
  @Get(':id')
  @Permissions('admin.trucks.view')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.truckService.getById(id);
    return { message: 'Truck fetched successfully', result };
  }
}
