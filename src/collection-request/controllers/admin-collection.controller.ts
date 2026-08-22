import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { AdminCollectionService } from '../services/admin-collection.service';
import {
  AdminCancelRequestDto,
  AdminListRequestsQueryDto,
  AssignCollectionRequestDto,
} from '../dto/admin-collection.dto';

/**
 * The admin's override surface for the collection queue: see everything,
 * hand a stuck request to a specific driver, cancel what the producer may
 * cancel. The manual assign still enforces the driver's hard filters — the
 * admin chooses WHO, not whether the rules apply.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/collection-requests', version: '1' })
export class AdminCollectionController {
  constructor(private readonly admin: AdminCollectionService) {}

  @Get()
  @Permissions('collection.admin.view')
  async list(@Query() query: AdminListRequestsQueryDto) {
    const result = await this.admin.listRequests(query);
    return { message: 'Collection requests', result };
  }

  @Post(':id/assign')
  @Permissions('collection.admin.manage')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCollectionRequestDto,
  ) {
    await this.admin.assign(id, dto.driver_id);
    return { message: 'Request assigned', result: { request_id: id } };
  }

  @Patch(':id/cancel')
  @Permissions('collection.admin.manage')
  async cancel(
    @CurrentUser() user,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCancelRequestDto,
  ) {
    const result = await this.admin.cancel(user.id, id, dto.reason);
    return { message: 'Request cancelled', result };
  }
}