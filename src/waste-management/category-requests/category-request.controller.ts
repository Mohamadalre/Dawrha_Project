import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { CategoryRequestService } from './category-request.service';
import {
  CategoryRequestQueryDto,
  CreateCategoryRequestDto,
  RejectCategoryRequestDto,
} from './dto/category-request.dto';

/**
 * Buyer side: an institution / factory / free facility requests extra categories
 * (beyond the ones chosen at onboarding). The request goes to the admin.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'waste/category-requests', version: '1' })
export class CategoryRequestController {
  constructor(private readonly service: CategoryRequestService) {}

  @Post()
  @Permissions('waste.categories.request')
  async create(@CurrentUser() user, @Body() dto: CreateCategoryRequestDto) {
    const result = await this.service.create(user, dto);
    return { message: result.message, result };
  }
}

/**
 * Admin side: review and decide on category requests.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/waste/category-requests', version: '1' })
export class AdminCategoryRequestController {
  constructor(private readonly service: CategoryRequestService) {}

  @Get()
  @Permissions('admin.categories.request.manage')
  async list(@Query() query: CategoryRequestQueryDto) {
    const result = await this.service.listForAdmin(query);
    return { message: 'Category requests fetched successfully', result };
  }

  @Patch(':requestId/approve')
  @Permissions('admin.categories.request.manage')
  async approve(@CurrentUser() user, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.service.approve(user.id, requestId);
  }

  @Patch(':requestId/reject')
  @Permissions('admin.categories.request.manage')
  async reject(
    @CurrentUser() user,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RejectCategoryRequestDto,
  ) {
    return this.service.reject(user.id, requestId, dto.reason);
  }
}
