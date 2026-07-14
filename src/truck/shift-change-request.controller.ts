import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { ShiftChangeRequestService } from './shift-change-request.service';
import { CreateShiftChangeRequestDto } from './dto/shift-change-request.dto';

/** Driver-facing shift-change requests (role: COLLECTOR). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.COLLECTOR)
@Controller({ path: 'shift-change-requests', version: '1' })
export class ShiftRequestController {
  constructor(private readonly service: ShiftChangeRequestService) {}

  @Post()
  async create(@CurrentUser() user: any, @Body() dto: CreateShiftChangeRequestDto) {
    const result = await this.service.create(user.id, dto);
    return { message: result.message, result };
  }

  @Get('mine')
  async mine(@CurrentUser() user: any) {
    const result = await this.service.listMine(user.id);
    return { message: 'Requests fetched successfully', result };
  }

  @Delete(':id')
  async cancel(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.service.cancel(user.id, id);
    return { message: result.message, result };
  }
}

/** Backend READ view only — the DECISION on these requests is made in ODOO
 * (pushed via PUSH_SHIFT_CHANGE, decided back via the shift-change-decision webhook). */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/shift-change-requests', version: '1' })
export class AdminShiftRequestController {
  constructor(private readonly service: ShiftChangeRequestService) {}

  @Get()
  @Permissions('admin.trucks.view')
  async list(@Query() query: PaginationQueryDto) {
    const result = await this.service.listAll(query);
    return { message: 'Requests fetched successfully', result };
  }

}
