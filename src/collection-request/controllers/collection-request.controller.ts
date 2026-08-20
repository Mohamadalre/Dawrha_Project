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
import { CollectionRequestService } from '../services/collection-request.service';
import {
  CancelCollectionRequestDto,
  CreateCollectionRequestDto,
} from '../dto/create-collection-request.dto';
import { ListCollectionRequestsQueryDto } from '../dto/list-collection-requests.dto';

/**
 * Collection request APIs for the producers (citizens and institutions):
 * create directly (no cart), list and read their own, and cancel before the
 * driver starts picking. The dispatch, driver and admin surfaces live in their
 * own controllers.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'collection-requests', version: '1' })
export class CollectionRequestController {
  constructor(private readonly collectionRequestService: CollectionRequestService) {}

  @Post()
  @Permissions('collection.requests.create')
  async create(@CurrentUser() user, @Body() dto: CreateCollectionRequestDto) {
    const result = await this.collectionRequestService.create(user, dto);
    return { message: 'Collection request created', result };
  }

  @Get()
  @Permissions('collection.requests.view')
  async list(
    @CurrentUser() user,
    @Query() query: ListCollectionRequestsQueryDto,
  ) {
    const result = await this.collectionRequestService.list(user, query);
    return { message: 'Collection requests fetched successfully', result };
  }

  @Get(':id')
  @Permissions('collection.requests.view')
  async detail(@CurrentUser() user, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.collectionRequestService.detail(user, id);
    return { message: 'Collection request fetched successfully', result };
  }

  @Patch(':id/cancel')
  @Permissions('collection.requests.cancel')
  async cancel(
    @CurrentUser() user,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCollectionRequestDto,
  ) {
    const result = await this.collectionRequestService.cancel(user, id, dto.reason);
    return { message: 'Collection request cancelled', result };
  }
}
