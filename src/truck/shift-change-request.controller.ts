import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { ShiftChangeRequestService } from './shift-change-request.service';
import { CreateShiftChangeRequestDto } from './dto/shift-change-request.dto';

/**
 * Driver-facing shift-change requests (role: COLLECTOR). The DECISION is the
 * warehouse manager's, made in Odoo — no admin/manager routes exist here.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.COLLECTOR)
@Controller({ path: 'shift-change-requests', version: '1' })
export class ShiftChangeRequestController {
  constructor(private readonly service: ShiftChangeRequestService) {}

  /** Shifts the driver may move into: his warehouse's driver shifts, minus his own. */
  @Get('available-shifts')
  async availableShifts(@CurrentUser() user: any) {
    return this.service.availableShifts(user.id);
  }

  /** Submit a request (ACTIVE + already has a truck + reason mandatory). */
  @Post()
  async create(@CurrentUser() user: any, @Body() dto: CreateShiftChangeRequestDto) {
    return this.service.create(user.id, dto);
  }

  /** The driver's own requests, newest first. */
  /** Every request this driver filed, any status — newest first, paginated. */
  @Get('mine')
  async mine(
    @CurrentUser() user: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.service.listMine(user.id, page, limit);
  }

  /** Cancel a still-PENDING request — removed from the backend AND Odoo. */
  @Delete(':id')
  async cancel(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(user.id, id);
  }
}
