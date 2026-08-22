import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { DriverOfferService } from '../services/driver-offer.service';

/**
 * Driver offer endpoints: accept or reject the pending dispatch offer. The
 * engine takes it from here — an acceptance binds the route, a rejection
 * elects the next candidate.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'driver/collection-requests', version: '1' })
export class DriverOfferController {
  constructor(private readonly driverOfferService: DriverOfferService) {}

  @Patch(':id/accept')
  @Permissions('collection.driver.manage')
  async accept(@CurrentUser() user, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.driverOfferService.accept(user, id);
    return { message: 'Offer accepted', result };
  }

  @Patch(':id/reject')
  @Permissions('collection.driver.manage')
  async reject(@CurrentUser() user, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.driverOfferService.reject(user, id);
    return { message: 'Offer rejected', result };
  }
}